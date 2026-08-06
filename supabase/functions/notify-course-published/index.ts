import {
  MAX_ANUNCIOS_POR_INVOCACION,
  PAGINA_DESTINATARIOS,
  PRESUPUESTO_MS_DEFAULT,
  allowedOrigin,
  debePausar,
  esEmailValido,
  esTokenExpoValido,
  resolverModoAutorizacion,
  siguienteCursor,
} from "./anuncios.mjs";
import { enviarEmail } from "../_shared/enviarEmail.ts";
import { enviarPush } from "../_shared/enviarPush.ts";
import { paraEmail, paraPush } from "../_shared/plantillas/nuevoCurso.ts";

const RESEND_BATCH_DELAY_MS = 600;

function corsHeaders(origin) {
  const result = { "Content-Type": "application/json; charset=utf-8", "Vary": "Origin" };
  if (origin) {
    result["Access-Control-Allow-Origin"] = origin;
    result["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    result["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return result;
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

function emptyCounters() {
  return { claimed: 0, sent: 0, paused: 0, failures: 0, recipients: 0 };
}

// Dropping tokens Expo reported as gone is housekeeping, not part of delivering
// the announcement: the rest of the page did go out. A failure here is logged
// and swallowed so it can never fail an announcement that actually succeeded.
async function olvidarTokensMuertos(serviceClient, dependencies, tokens) {
  if (tokens.length === 0) return;
  try {
    const { error } = await serviceClient.from("push_devices").delete().in("expo_push_token", tokens);
    if (error) {
      dependencies.logger.error(JSON.stringify({
        event: "push_device_cleanup_failed",
        tokens: tokens.length,
      }));
    }
  } catch {
    dependencies.logger.error(JSON.stringify({
      event: "push_device_cleanup_exception",
      tokens: tokens.length,
    }));
  }
}

// The bundle every queue transition RPC keys its update by. Missing p_canal
// here was exactly the 2026-08-04 incident: a push job's transition matched
// zero rows against the SQL default of 'email', read as failure, and the
// five-minute staleness reclaim kept resending it — attempt_count hit 201.
function argsDelClaim(job) {
  return {
    p_curso_id: job.curso_id,
    p_claim_token: job.claim_token,
    p_claim_generation: job.claim_generation,
    p_canal: job.canal,
  };
}

// The primary failure (recipients lookup, send, or cursor advance) always
// counts as one. If the bookkeeping retry call itself also fails too, that's
// a second, distinct failure: the row is now stuck until the next staleness
// reclaim, not just scheduled for a normal backoff retry.
async function fallar(serviceClient, job, counters, motivo) {
  const retry = await serviceClient.rpc("reintentar_curso_anuncio", {
    ...argsDelClaim(job),
    p_sanitized_error: motivo,
  });
  counters.failures = 1;
  if (retry.error || retry.data !== true) counters.failures++;
  return { counters, stop: true };
}

async function procesarAnuncio(serviceClient, dependencies, job, contexto) {
  const { inicio, presupuestoMs, siteUrl, remitente, resendApiKey } = contexto;
  const counters = emptyCounters();
  counters.claimed = 1;
  // Everything below the channel split is shared: the pagination loop, the time
  // budget, the cursor and the closing handshake. Only who we ask for the page,
  // how we filter it, and where we send it change.
  const esPush = job.canal === "push";
  const rpcDestinatarios = esPush ? "destinatarios_push_curso_anuncio" : "destinatarios_curso_anuncio";
  let cursor = job.ultimo_destinatario ?? null;

  for (;;) {
    if (debePausar(dependencies.now() - inicio, presupuestoMs)) {
      const pausa = await serviceClient.rpc("pausar_curso_anuncio", argsDelClaim(job));
      counters.paused = 1;
      if (pausa.error || pausa.data !== true) counters.failures++;
      return { counters, stop: true };
    }

    const page = await serviceClient.rpc(rpcDestinatarios, {
      desde: cursor,
      limite: PAGINA_DESTINATARIOS,
    });
    if (page.error) {
      return fallar(serviceClient, job, counters, "recipients_lookup_failed");
    }

    const destinatarios = Array.isArray(page.data) ? page.data : [];
    const validos = esPush
      ? destinatarios.filter((row) => esTokenExpoValido(row?.expo_push_token))
      : destinatarios.filter((row) => esEmailValido(row?.email));
    // The page length, not the valid count, decides the last page: the push RPC
    // left-joins on purpose, so a page of users without the app is short on
    // tokens but still a full page of scanned users.
    const isLastPage = destinatarios.length < PAGINA_DESTINATARIOS;

    if (validos.length > 0) {
      let resultado;
      if (esPush) {
        const mensajes = validos.map((destinatario) => paraPush({
          titulo: job.titulo,
          cursoId: job.curso_id,
          destinatario,
        }));
        resultado = await enviarPush(dependencies, mensajes);
        await olvidarTokensMuertos(serviceClient, dependencies, resultado.muertos ?? []);
      } else {
        const mensajes = validos.map((destinatario) => paraEmail({
          titulo: job.titulo,
          destinatario,
          siteUrl,
          remitente,
        }));
        resultado = await enviarEmail(dependencies, resendApiKey, mensajes);
        await dependencies.sleep(RESEND_BATCH_DELAY_MS);
      }
      if (!resultado.ok) {
        return fallar(serviceClient, job, counters, resultado.reason);
      }
      counters.recipients += validos.length;
    }

    const nuevoCursor = siguienteCursor(destinatarios, cursor);
    const avance = await serviceClient.rpc("avanzar_curso_anuncio", {
      ...argsDelClaim(job),
      p_ultimo: nuevoCursor,
      p_enviados: validos.length,
    });
    if (avance.error || avance.data !== true) {
      // Si el cursor no quedó persistido, seguir en memoria haría que la
      // próxima invocación retome desde el valor viejo de la BD y reenvíe
      // esta página entera. Cortamos acá, igual que ante un fallo de Resend:
      // el reintento parte del mismo punto que ya está guardado.
      return fallar(serviceClient, job, counters, "advance_cursor_failed");
    }
    cursor = nuevoCursor;

    if (isLastPage) {
      const completar = await serviceClient.rpc("completar_curso_anuncio", argsDelClaim(job));
      counters.sent = 1;
      if (completar.error || completar.data !== true) counters.failures++;
      return { counters, stop: false };
    }
  }
}

export function createNotifyCoursePublishedHandler(overrides = {}) {
  const dependencies = {
    getEnv: (name) => globalThis.Deno?.env?.get(name),
    fetchImpl: globalThis.fetch?.bind(globalThis),
    createCallerClient: createFetchCallerClient,
    createServiceClient: createSupabaseServiceClient,
    logger: globalThis.console,
    now: () => globalThis.performance?.now?.() ?? Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...overrides,
  };

  return async function handleNotifyCoursePublished(request) {
    const inicio = dependencies.now();
    let responseOrigin = null;
    const finish = (status, code, payload, origin, counters) => {
      const event = {
        event: "notify_course_published",
        code,
        status,
        durationMs: Math.max(0, Math.round(dependencies.now() - inicio)),
        claimed: counters?.claimed ?? 0,
        sent: counters?.sent ?? 0,
        paused: counters?.paused ?? 0,
        failures: counters?.failures ?? 0,
        recipients: counters?.recipients ?? 0,
      };
      dependencies.logger[status >= 400 ? "error" : "info"](JSON.stringify(event));
      return new Response(payload === null ? null : JSON.stringify(payload), {
        status,
        headers: corsHeaders(origin),
      });
    };

    try {
      const requestOrigin = request.headers.get("origin");
      const origin = allowedOrigin(requestOrigin) ? requestOrigin : null;
      responseOrigin = origin;
      if (request.method === "OPTIONS") return finish(204, "preflight_ok", null, origin, null);
      if (request.method !== "POST") {
        return finish(405, "method_not_allowed", { ok: false, code: "method_not_allowed" }, origin, null);
      }

      const authorization = request.headers.get("authorization");
      const cronSecretHeader = request.headers.get("x-taudux-anuncios-secret");
      const cronSecretEnv = dependencies.getEnv("ANUNCIOS_CRON_SECRET");

      let esAdmin = null;
      let caller = null;
      const projectUrl = dependencies.getEnv("SUPABASE_URL");
      const anonKey = dependencies.getEnv("SUPABASE_ANON_KEY");
      if (allowedOrigin(requestOrigin) && authorization) {
        if (!projectUrl || !anonKey) {
          return finish(500, "internal_error", { ok: false, code: "internal_error" }, origin, null);
        }
        caller = dependencies.createCallerClient({
          projectUrl,
          anonKey,
          authorization,
          fetchImpl: dependencies.fetchImpl,
        });
        const { data: userData, error: userError } = await caller.auth.getUser();
        if (!userError && userData?.user) {
          const admin = await caller.rpc("es_admin");
          esAdmin = admin.error ? null : admin.data;
        }
      }

      const modo = resolverModoAutorizacion({
        origin: requestOrigin,
        authorization,
        cronSecretHeader,
        cronSecretEnv,
        esAdmin,
      });
      if (!modo) {
        return finish(403, "invalid_caller", { ok: false, code: "invalid_caller" }, origin, null);
      }

      const serviceRole = dependencies.getEnv("SUPABASE_SERVICE_ROLE_KEY");
      const resendApiKey = dependencies.getEnv("RESEND_API_KEY");
      const remitente = dependencies.getEnv("CORREO_REMITENTE");
      const siteUrl = dependencies.getEnv("SITE_URL");
      if (!projectUrl || !serviceRole || !resendApiKey || !remitente || !siteUrl) {
        return finish(500, "internal_error", { ok: false, code: "internal_error" }, origin, null);
      }

      const serviceClient = await dependencies.createServiceClient({ projectUrl, serviceRole });
      const counters = emptyCounters();
      const contexto = {
        inicio,
        presupuestoMs: PRESUPUESTO_MS_DEFAULT,
        siteUrl,
        remitente,
        resendApiKey,
      };

      for (let index = 0; index < MAX_ANUNCIOS_POR_INVOCACION; index++) {
        if (debePausar(dependencies.now() - inicio, PRESUPUESTO_MS_DEFAULT)) break;

        const claim = await serviceClient.rpc("claim_curso_anuncio");
        if (claim.error) {
          counters.failures++;
          break;
        }
        const job = firstRow(claim.data);
        if (!job) break;

        const resultado = await procesarAnuncio(serviceClient, dependencies, job, contexto);
        counters.claimed += resultado.counters.claimed;
        counters.sent += resultado.counters.sent;
        counters.paused += resultado.counters.paused;
        counters.failures += resultado.counters.failures;
        counters.recipients += resultado.counters.recipients;

        if (resultado.stop) break;
      }

      return finish(200, "notify_ok", {
        ok: true,
        claimed: counters.claimed,
        sent: counters.sent,
        paused: counters.paused,
        failures: counters.failures,
        recipients: counters.recipients,
      }, origin, counters);
    } catch {
      return finish(500, "internal_error", { ok: false, code: "internal_error" }, responseOrigin, null);
    }
  };
}

function createFetchCallerClient({ projectUrl, anonKey, authorization, fetchImpl }) {
  const headers = { apikey: anonKey, Authorization: authorization };
  return {
    auth: {
      async getUser() {
        const response = await fetchImpl(`${projectUrl}/auth/v1/user`, { headers });
        if (!response.ok) return { data: { user: null }, error: true };
        const user = await response.json();
        return { data: { user }, error: user?.id ? null : true };
      },
    },
    async rpc(name) {
      if (name !== "es_admin") return { data: null, error: true };
      const response = await fetchImpl(`${projectUrl}/rest/v1/rpc/es_admin`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{}",
      });
      return response.ok ? { data: await response.json(), error: null } : { data: null, error: true };
    },
  };
}

async function createSupabaseServiceClient({ projectUrl, serviceRole }) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(projectUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Keep platform JWT verification enabled: the cron workflow sends
// Authorization: Bearer <SUPABASE_ANON_KEY> purely so Supabase's platform JWT
// check stays satisfied. That header is never used to authorize cron mode —
// only the x-taudux-anuncios-secret header does, compared in constant time.
if (globalThis.Deno && typeof globalThis.Deno.serve === "function") {
  globalThis.Deno.serve(createNotifyCoursePublishedHandler());
}

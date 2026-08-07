/*
  Borrado de la propia cuenta. Equivale a lo que hace un admin desde el dashboard
  de Supabase Auth, pero en autoservicio: `auth.admin.deleteUser` exige el service
  role, que jamás puede vivir en el navegador.

  A diferencia de remove-course-cover no hay ningún chequeo de rol: cualquier
  usuario autenticado puede borrarse a sí mismo. Lo que sí es innegociable es de
  DÓNDE sale el id a borrar — siempre del JWT verificado, nunca del body. El body
  no se lee en absoluto, así que no hay forma de pedir el borrado de otra cuenta.
*/

const PRODUCTION_ORIGINS = new Set(["https://taudux.com"]);

function allowedOrigin(origin) {
  if (!origin || origin === "null") return false;
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.origin === origin && url.protocol === "http:" && Boolean(url.port) &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const result = { "Content-Type": "application/json; charset=utf-8", "Vary": "Origin" };
  if (origin) {
    result["Access-Control-Allow-Origin"] = origin;
    result["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    result["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return result;
}

export function createDeleteAccountHandler(overrides = {}) {
  const dependencies = {
    getEnv: (name) => globalThis.Deno?.env?.get(name),
    fetchImpl: globalThis.fetch?.bind(globalThis),
    createCallerClient: createFetchCallerClient,
    createServiceClient: createSupabaseServiceClient,
    logger: globalThis.console,
    now: () => globalThis.performance?.now?.() ?? Date.now(),
    ...overrides,
  };

  return async function handleDeleteAccount(request) {
    const started = dependencies.now();
    let responseOrigin = null;
    const finish = (status, code, payload, origin) => {
      const event = {
        event: "delete_account",
        code,
        status,
        durationMs: Math.max(0, Math.round(dependencies.now() - started)),
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
      if (!origin) return finish(403, "invalid_origin", { ok: false, code: "invalid_origin" }, null);
      responseOrigin = origin;
      if (request.method === "OPTIONS") return finish(204, "preflight_ok", null, origin);
      if (request.method !== "POST") {
        return finish(405, "method_not_allowed", { ok: false, code: "method_not_allowed" }, origin);
      }

      const authorization = request.headers.get("authorization");
      if (!authorization) return finish(401, "auth_required", { ok: false, code: "auth_required" }, origin);
      const projectUrl = dependencies.getEnv("SUPABASE_URL");
      const anonKey = dependencies.getEnv("SUPABASE_ANON_KEY");
      if (!projectUrl || !anonKey) return finish(500, "internal_error", { ok: false, code: "internal_error" }, origin);

      const caller = dependencies.createCallerClient({ projectUrl, anonKey, authorization, fetchImpl: dependencies.fetchImpl });
      const { data: userData, error: userError } = await caller.auth.getUser();
      if (userError || !userData?.user?.id) {
        return finish(401, "auth_required", { ok: false, code: "auth_required" }, origin);
      }

      const serviceRole = dependencies.getEnv("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRole) return finish(500, "internal_error", { ok: false, code: "internal_error" }, origin);
      const serviceClient = await dependencies.createServiceClient({ projectUrl, serviceRole });

      /*
        Registro de la baja ANTES del borrado, mientras la cuenta todavía
        existe: es sólo enriquecimiento (marca origen='autoservicio'). El
        trigger perfiles_registrar_baja (migración 0027) ya garantiza la fila
        vía cascada, atómicamente, así que un fallo acá NO aborta el borrado
        — el usuario tiene derecho a irse aunque falle la analítica.
      */
      let eventoBajaId = null;
      try {
        const { data: eventoData, error: eventoError } = await serviceClient
          .from("eventos_negocio")
          .insert({ tipo: "baja_cuenta", usuario_ref: userData.user.id, origen: "autoservicio" })
          .select("id")
          .single();
        if (eventoError) throw eventoError;
        eventoBajaId = eventoData?.id ?? null;
      } catch {
        dependencies.logger.error(JSON.stringify({ event: "delete_account", code: "evento_baja_failed" }));
      }

      /*
        Hard delete deliberado. Con soft delete la fila de auth.users sobrevive
        con deleted_at, y el ON DELETE CASCADE de perfiles.id nunca se dispara:
        el perfil quedaría vivo y huérfano.

        Try/catch propio (no el de afuera): deleteUser puede fallar
        RESOLVIENDO con { error } o RECHAZANDO la promesa (timeout de red,
        excepción del SDK). Los dos casos son "el borrado no ocurrió" y los
        dos deben compensar la baja registrada arriba — si sólo el primero
        compensara, un reject dejaría una fila baja_cuenta huérfana para una
        cuenta que sigue existiendo.
      */
      try {
        const { error: deleteError } = await serviceClient.auth.admin.deleteUser(userData.user.id);
        if (deleteError) throw deleteError;
      } catch {
        if (eventoBajaId !== null) {
          try {
            await serviceClient.from("eventos_negocio").delete().eq("id", eventoBajaId);
          } catch {
            // Compensación best-effort: si también falla, queda un evento
            // huérfano — inaceptable en silencio, pero no hay nada más
            // seguro que hacer acá que devolver el error real al usuario.
          }
        }
        return finish(500, "internal_error", { ok: false, code: "internal_error" }, origin);
      }

      return finish(200, "delete_ok", { ok: true }, origin);
    } catch {
      return finish(500, "internal_error", { ok: false, code: "internal_error" }, responseOrigin);
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
  };
}

async function createSupabaseServiceClient({ projectUrl, serviceRole }) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(projectUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Keep platform JWT verification enabled when deploying this browser endpoint.
if (globalThis.Deno && typeof globalThis.Deno.serve === "function") {
  globalThis.Deno.serve(createDeleteAccountHandler());
}

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ANUNCIOS_PATH = path.resolve("supabase/functions/notify-course-published/anuncios.mjs");
const FUNCTION_PATH = path.resolve("supabase/functions/notify-course-published/index.ts");
const anunciosModule = import(pathToFileURL(ANUNCIOS_PATH).href);
const endpoint = import(pathToFileURL(FUNCTION_PATH).href);

const ORIGIN = "https://taudux.com";
const PROJECT_URL = "https://yqkvgfqplmbbcebrivpt.supabase.co";
const CURSO_ID = "123e4567-e89b-42d3-a456-426614174000";
const CLAIM_TOKEN = "123e4567-e89b-42d3-a456-426614174111";
const CRON_SECRET = "cron-secret-value";

function makeId(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function destinatariosDePagina(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    id: makeId(offset + index + 1),
    email: `user${offset + index + 1}@example.com`,
  }));
}

function destinatariosPushDePagina(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    id: makeId(offset + index + 1),
    expo_push_token: `ExponentPushToken[user${offset + index + 1}]`,
  }));
}

test("resolverModoAutorizacion: admin válido, origin ajeno, secreto cron, y secreto ausente", async () => {
  const { resolverModoAutorizacion } = await anunciosModule;

  assert.equal(resolverModoAutorizacion({
    origin: ORIGIN,
    authorization: "Bearer admin",
    cronSecretHeader: null,
    cronSecretEnv: CRON_SECRET,
    esAdmin: true,
  }), "admin");

  assert.equal(resolverModoAutorizacion({
    origin: "https://evil.example",
    authorization: "Bearer admin",
    cronSecretHeader: null,
    cronSecretEnv: CRON_SECRET,
    esAdmin: true,
  }), null);

  assert.equal(resolverModoAutorizacion({
    origin: null,
    authorization: null,
    cronSecretHeader: CRON_SECRET,
    cronSecretEnv: CRON_SECRET,
    esAdmin: null,
  }), "cron");

  assert.equal(resolverModoAutorizacion({
    origin: null,
    authorization: null,
    cronSecretHeader: "wrong-secret",
    cronSecretEnv: CRON_SECRET,
    esAdmin: null,
  }), null);

  for (const cronSecretEnv of [undefined, null, ""]) {
    assert.equal(resolverModoAutorizacion({
      origin: null,
      authorization: null,
      cronSecretHeader: "",
      cronSecretEnv,
      esAdmin: null,
    }), null);
  }
});

test("esEmailValido acepta direcciones normales y rechaza inválidas", async () => {
  const { esEmailValido } = await anunciosModule;
  assert.equal(esEmailValido("persona@example.com"), true);
  assert.equal(esEmailValido("sin-arroba.example.com"), false);
  assert.equal(esEmailValido("con espacio@example.com"), false);
});

test("construirLoteResend arma un lote con baja y asunto correctos", async () => {
  const { construirLoteResend } = await anunciosModule;
  const destinatarios = destinatariosDePagina(3);
  const lote = construirLoteResend({
    titulo: "Curso de Testing",
    cursoId: CURSO_ID,
    destinatarios,
    siteUrl: "https://taudux.com",
    remitente: "Taudux <avisos@taudux.com>",
  });
  assert.equal(lote.length, 3);
  for (const [index, mensaje] of lote.entries()) {
    assert.deepEqual(mensaje.to, [destinatarios[index].email]);
    assert.match(mensaje.subject, /Curso de Testing/);
    assert.match(mensaje.html, /portal\/#correo/);
    assert.match(mensaje.text, /portal\/#correo/);
    assert.equal(mensaje.headers["List-Unsubscribe"], "<https://taudux.com/app/features/portal/#correo>");
  }
});

test("construirLoteResend no usa voseo rioplatense: el resto del sitio es español neutro", async () => {
  const { construirLoteResend } = await anunciosModule;
  const [mensaje] = construirLoteResend({
    titulo: "Curso de Testing",
    cursoId: CURSO_ID,
    destinatarios: destinatariosDePagina(1),
    siteUrl: "https://taudux.com",
    remitente: "Taudux <avisos@taudux.com>",
  });
  assert.doesNotMatch(mensaje.text, /\b(querés|podés|dejá|tenés|sabés)\b/i);
  assert.doesNotMatch(mensaje.html, /\b(querés|podés|dejá|tenés|sabés)\b/i);
});

test("debePausar respeta el presupuesto de tiempo", async () => {
  const { debePausar } = await anunciosModule;
  assert.equal(debePausar(1000, 40000), false);
  assert.equal(debePausar(41000, 40000), true);
});

test("siguienteCursor devuelve el último id o el cursor original si no hay filas", async () => {
  const { siguienteCursor } = await anunciosModule;
  const destinatarios = destinatariosDePagina(2);
  assert.equal(siguienteCursor(destinatarios, null), destinatarios[1].id);
  assert.equal(siguienteCursor([], "cursor-anterior"), "cursor-anterior");
});

test("esTokenExpoValido acepta tokens de Expo y rechaza el null del left join", async () => {
  const { esTokenExpoValido } = await anunciosModule;
  assert.equal(esTokenExpoValido("ExponentPushToken[P1psCoMfxPxlVbLTJUuTss]"), true);
  // La RPC hace left join contra push_devices: un usuario sin la app instalada
  // llega hasta acá con el token en null. Ése es el caso que este filtro existe
  // para descartar, igual que esEmailValido descarta correos rotos.
  assert.equal(esTokenExpoValido(null), false);
  assert.equal(esTokenExpoValido(undefined), false);
  assert.equal(esTokenExpoValido(""), false);
  assert.equal(esTokenExpoValido("FCM[algo]"), false);
  assert.equal(esTokenExpoValido("ExponentPushToken[]"), false);
  assert.equal(esTokenExpoValido("ExponentPushToken[sin-cierre"), false);
});

test("construirLotePush arma mensajes de Expo con el canal y el curso en data", async () => {
  const { construirLotePush } = await anunciosModule;
  const destinatarios = destinatariosPushDePagina(3);
  const lote = construirLotePush({
    titulo: "Curso de Testing",
    cursoId: CURSO_ID,
    destinatarios,
    siteUrl: "https://taudux.com",
  });
  assert.equal(lote.length, 3);
  for (const [index, mensaje] of lote.entries()) {
    assert.equal(mensaje.to, destinatarios[index].expo_push_token);
    assert.match(mensaje.title, /Curso de Testing/);
    // El canal lo crea la app con importancia MAX; sin este id Android manda la
    // notificación al canal por defecto y pierde prioridad y vibración.
    assert.equal(mensaje.channelId, "course-announcements");
    assert.equal(mensaje.data.cursoId, CURSO_ID);
  }
});

test("construirLotePush no usa voseo rioplatense: el resto del sitio es español neutro", async () => {
  const { construirLotePush } = await anunciosModule;
  const [mensaje] = construirLotePush({
    titulo: "Curso de Testing",
    cursoId: CURSO_ID,
    destinatarios: destinatariosPushDePagina(1),
    siteUrl: "https://taudux.com",
  });
  assert.doesNotMatch(mensaje.title, /\b(querés|podés|dejá|tenés|sabés)\b/i);
  assert.doesNotMatch(mensaje.body, /\b(querés|podés|dejá|tenés|sabés)\b/i);
});

test("trocearLotePush parte en tandas de 100, que es el máximo que acepta Expo", async () => {
  const { trocearLotePush, MAX_MENSAJES_EXPO } = await anunciosModule;
  assert.equal(MAX_MENSAJES_EXPO, 100);
  // Una página son 100 usuarios, pero un usuario puede tener varios
  // dispositivos: 250 tokens salen de una sola página y no entran en un request.
  const mensajes = Array.from({ length: 250 }, (_, index) => ({ to: `t${index}` }));
  const tandas = trocearLotePush(mensajes);
  assert.deepEqual(tandas.map((tanda) => tanda.length), [100, 100, 50]);
  assert.deepEqual(tandas.flat(), mensajes);
  assert.deepEqual(trocearLotePush([]), []);
});

test("tokensNoRegistrados extrae sólo los tokens que Expo reporta como muertos", async () => {
  const { tokensNoRegistrados } = await anunciosModule;
  const mensajes = [{ to: "token-vivo" }, { to: "token-muerto" }, { to: "token-lento" }];
  const respuesta = {
    data: [
      { status: "ok", id: "ticket-1" },
      { status: "error", message: "...", details: { error: "DeviceNotRegistered" } },
      { status: "error", message: "...", details: { error: "MessageRateExceeded" } },
    ],
  };
  // Sólo DeviceNotRegistered significa "app desinstalada". MessageRateExceeded
  // es transitorio: borrar ese token perdería un dispositivo que sigue vivo.
  assert.deepEqual(tokensNoRegistrados(mensajes, respuesta), ["token-muerto"]);
  assert.deepEqual(tokensNoRegistrados(mensajes, { data: [] }), []);
  assert.deepEqual(tokensNoRegistrados(mensajes, {}), []);
  assert.deepEqual(tokensNoRegistrados(mensajes, null), []);
});

async function payload(response) {
  return JSON.parse(await response.text());
}

function notifyRequest(options = {}) {
  const { method = "POST" } = options;
  const headers = {};
  if (Object.hasOwn(options, "origin")) {
    if (options.origin !== undefined) headers.origin = options.origin;
  } else {
    headers.origin = ORIGIN;
  }
  if (Object.hasOwn(options, "authorization")) {
    if (options.authorization !== undefined) headers.authorization = options.authorization;
  } else {
    headers.authorization = "Bearer admin";
  }
  if (Object.hasOwn(options, "cronSecret") && options.cronSecret !== undefined) {
    headers["x-taudux-anuncios-secret"] = options.cronSecret;
  }
  return new Request("https://edge.test/notify", { method, headers });
}

async function createHarness(options = {}) {
  const { createNotifyCoursePublishedHandler } = await endpoint;
  const calls = { rpc: [], logs: [], fetches: [] };
  const jobs = [...(options.jobs ?? [])];
  const pages = [...(options.pages ?? [])];
  let fetchCallCount = 0;

  const serviceClient = {
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (name === "claim_curso_anuncio") {
        return { data: jobs.length ? [jobs.shift()] : [], error: options.claimError || null };
      }
      if (name === "destinatarios_curso_anuncio") {
        const page = pages.length ? pages.shift() : [];
        return { data: page, error: options.pageError || null };
      }
      if (name === "avanzar_curso_anuncio") {
        return { data: options.avanzarResult ?? true, error: options.avanzarError || null };
      }
      if (name === "completar_curso_anuncio") {
        return { data: options.completarResult ?? true, error: options.completarError || null };
      }
      if (name === "pausar_curso_anuncio") {
        return { data: options.pausarResult ?? true, error: options.pausarError || null };
      }
      if (name === "reintentar_curso_anuncio") {
        return { data: options.reintentarResult ?? true, error: options.reintentarError || null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };

  const nowValues = options.nowValues;
  let nowIndex = 0;

  const dependencies = {
    getEnv(name) {
      return {
        SUPABASE_URL: PROJECT_URL,
        SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-secret",
        RESEND_API_KEY: "resend-secret",
        ANUNCIOS_CRON_SECRET: CRON_SECRET,
        CORREO_REMITENTE: "Taudux <avisos@taudux.com>",
        SITE_URL: "https://taudux.com",
      }[name];
    },
    createCallerClient() {
      return {
        auth: {
          async getUser() {
            return options.invalidUser
              ? { data: { user: null }, error: true }
              : { data: { user: { id: "admin-id" } }, error: null };
          },
        },
        async rpc(name) {
          assert.equal(name, "es_admin");
          return { data: options.admin === false ? false : true, error: null };
        },
      };
    },
    async createServiceClient() {
      return serviceClient;
    },
    fetchImpl: async (url, init) => {
      fetchCallCount++;
      calls.fetches.push({ url, body: init.body });
      const statuses = options.fetchStatuses ?? [200];
      const status = statuses[Math.min(fetchCallCount - 1, statuses.length - 1)];
      return { ok: status >= 200 && status < 300, status };
    },
    sleep: async () => {},
    logger: {
      info(value) { calls.logs.push({ level: "info", value }); },
      error(value) { calls.logs.push({ level: "error", value }); },
    },
    now: nowValues ? (() => nowValues[Math.min(nowIndex++, nowValues.length - 1)]) : (() => 0),
  };

  return { calls, handler: createNotifyCoursePublishedHandler(dependencies) };
}

test("origin inválido y sin credenciales de admin ni cron responde 403 invalid_caller", async () => {
  const { handler } = await createHarness();
  const response = await handler(notifyRequest({ origin: "https://evil.example", authorization: undefined }));
  assert.equal(response.status, 403);
  assert.equal((await payload(response)).code, "invalid_caller");
});

test("sin ser admin y sin secreto de cron responde 403 invalid_caller", async () => {
  const { handler } = await createHarness({ admin: false });
  const response = await handler(notifyRequest());
  assert.equal(response.status, 403);
  assert.equal((await payload(response)).code, "invalid_caller");
});

test("modo cron válido sin nada para reclamar devuelve 200 con contadores en cero", async () => {
  const { handler, calls } = await createHarness({
    origin: undefined,
    jobs: [],
  });
  const response = await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.equal(response.status, 200);
  assert.deepEqual(await payload(response), {
    ok: true, claimed: 0, sent: 0, paused: 0, failures: 0, recipients: 0,
  });
  assert.ok(calls.rpc.some((call) => call.name === "claim_curso_anuncio"));
});

test("modo cron con un anuncio de dos páginas envía ambas y completa una vez", async () => {
  const { handler, calls } = await createHarness({
    jobs: [{ curso_id: CURSO_ID, titulo: "Curso X", claim_token: CLAIM_TOKEN, claim_generation: 1, ultimo_destinatario: null, attempt_count: 1 }],
    pages: [destinatariosDePagina(100), destinatariosDePagina(30, 100)],
    fetchStatuses: [200, 200],
  });
  const response = await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.equal(response.status, 200);
  const body = await payload(response);
  assert.equal(body.claimed, 1);
  assert.equal(body.sent, 1);
  assert.equal(body.failures, 0);
  assert.equal(body.recipients, 130);
  const completar = calls.rpc.filter((call) => call.name === "completar_curso_anuncio");
  assert.equal(completar.length, 1);
  const avanzar = calls.rpc.filter((call) => call.name === "avanzar_curso_anuncio");
  assert.equal(avanzar.length, 2);
  const claimIndex = calls.rpc.findIndex((call) => call.name === "claim_curso_anuncio");
  const completarIndex = calls.rpc.findIndex((call) => call.name === "completar_curso_anuncio");
  assert.ok(claimIndex < completarIndex);
});

test("la segunda página falla y se reintenta sin completar; el cursor corresponde a la primera página", async () => {
  const primeraPagina = destinatariosDePagina(100);
  const { handler, calls } = await createHarness({
    jobs: [{ curso_id: CURSO_ID, titulo: "Curso X", claim_token: CLAIM_TOKEN, claim_generation: 1, ultimo_destinatario: null, attempt_count: 1 }],
    pages: [primeraPagina, destinatariosDePagina(30, 100)],
    fetchStatuses: [200, 500],
  });
  const response = await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.equal(response.status, 200);
  const body = await payload(response);
  assert.equal(body.failures, 1);
  assert.ok(!calls.rpc.some((call) => call.name === "completar_curso_anuncio"));
  const reintentar = calls.rpc.find((call) => call.name === "reintentar_curso_anuncio");
  assert.ok(reintentar);
  const avanzar = calls.rpc.find((call) => call.name === "avanzar_curso_anuncio");
  assert.equal(avanzar.args.p_ultimo, primeraPagina[primeraPagina.length - 1].id);
});

test("presupuesto de tiempo agotado antes de la segunda página pausa en vez de seguir", async () => {
  const { handler, calls } = await createHarness({
    jobs: [{ curso_id: CURSO_ID, titulo: "Curso X", claim_token: CLAIM_TOKEN, claim_generation: 1, ultimo_destinatario: null, attempt_count: 1 }],
    pages: [destinatariosDePagina(100), destinatariosDePagina(30, 100)],
    fetchStatuses: [200, 200],
    nowValues: [0, 0, 0, 41000, 41000, 41000, 41000, 41000, 41000, 41000],
  });
  const response = await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.equal(response.status, 200);
  const body = await payload(response);
  assert.equal(body.paused, 1);
  assert.ok(!calls.rpc.some((call) => call.name === "completar_curso_anuncio"));
  assert.ok(calls.rpc.some((call) => call.name === "pausar_curso_anuncio"));
});

test("un fallo al persistir avanzar_curso_anuncio corta el anuncio y no completa", async () => {
  /*
    Si avanzar_curso_anuncio falla en la BD después de un envío exitoso a
    Resend, seguir a la próxima página con el cursor solo en memoria dejaría
    la BD con el valor viejo. Si el proceso muere después, la próxima
    invocación reenviaría esa página entera. Debe cortar y reintentar desde
    el mismo punto ya persistido, igual que ante un fallo de Resend.
  */
  const primeraPagina = destinatariosDePagina(100);
  const { handler, calls } = await createHarness({
    jobs: [{ curso_id: CURSO_ID, titulo: "Curso X", claim_token: CLAIM_TOKEN, claim_generation: 1, ultimo_destinatario: null, attempt_count: 1 }],
    pages: [primeraPagina, destinatariosDePagina(30, 100)],
    fetchStatuses: [200, 200],
    avanzarResult: false,
  });
  const response = await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.equal(response.status, 200);
  const body = await payload(response);
  assert.equal(body.failures, 1);
  assert.ok(!calls.rpc.some((call) => call.name === "completar_curso_anuncio"));
  const avanzar = calls.rpc.filter((call) => call.name === "avanzar_curso_anuncio");
  assert.equal(avanzar.length, 1, "no debe intentar una segunda página tras el fallo de avance");
  const reintentar = calls.rpc.find((call) => call.name === "reintentar_curso_anuncio");
  assert.ok(reintentar);
  assert.equal(reintentar.args.p_sanitized_error, "advance_cursor_failed");
});

test("el evento de log final nunca contiene un correo", async () => {
  const { handler, calls } = await createHarness({
    jobs: [{ curso_id: CURSO_ID, titulo: "Curso X", claim_token: CLAIM_TOKEN, claim_generation: 1, ultimo_destinatario: null, attempt_count: 1 }],
    pages: [destinatariosDePagina(5)],
    fetchStatuses: [200],
  });
  await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.ok(calls.logs.length > 0);
  for (const log of calls.logs) {
    assert.doesNotMatch(log.value, /@/);
  }
});

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ANUNCIOS_PATH = path.resolve("supabase/functions/notify-course-published/anuncios.mjs");
const FUNCTION_PATH = path.resolve("supabase/functions/notify-course-published/index.ts");
const PLANTILLA_PATH = path.resolve("supabase/functions/_shared/plantillas/nuevoCurso.ts");
const ENVIAR_PUSH_PATH = path.resolve("supabase/functions/_shared/enviarPush.ts");
const anunciosModule = import(pathToFileURL(ANUNCIOS_PATH).href);
const endpoint = import(pathToFileURL(FUNCTION_PATH).href);
const plantillaModule = import(pathToFileURL(PLANTILLA_PATH).href);
const enviarPushModule = import(pathToFileURL(ENVIAR_PUSH_PATH).href);

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

test("paraEmail arma un lote con baja y asunto correctos", async () => {
  const { paraEmail } = await plantillaModule;
  const destinatarios = destinatariosDePagina(3);
  const lote = destinatarios.map((destinatario) => paraEmail({
    titulo: "Curso de Testing",
    cursoId: CURSO_ID,
    destinatario,
    siteUrl: "https://taudux.com",
    remitente: "Taudux <avisos@taudux.com>",
  }));
  assert.equal(lote.length, 3);
  for (const [index, mensaje] of lote.entries()) {
    assert.deepEqual(mensaje.to, [destinatarios[index].email]);
    assert.match(mensaje.subject, /Curso de Testing/);
    assert.match(mensaje.html, /portal\/#correo/);
    assert.match(mensaje.text, /portal\/#correo/);
    assert.equal(mensaje.headers["List-Unsubscribe"], "<https://taudux.com/app/features/portal/#correo>");
  }
});

test("paraEmail no usa voseo rioplatense: el resto del sitio es español neutro", async () => {
  const { paraEmail } = await plantillaModule;
  const mensaje = paraEmail({
    titulo: "Curso de Testing",
    cursoId: CURSO_ID,
    destinatario: destinatariosDePagina(1)[0],
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

test("paraPush arma mensajes de Expo con el canal y el curso en data", async () => {
  const { paraPush } = await plantillaModule;
  const destinatarios = destinatariosPushDePagina(3);
  const lote = destinatarios.map((destinatario) => paraPush({
    titulo: "Curso de Testing",
    cursoId: CURSO_ID,
    destinatario,
    siteUrl: "https://taudux.com",
  }));
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

test("paraPush no usa voseo rioplatense: el resto del sitio es español neutro", async () => {
  const { paraPush } = await plantillaModule;
  const mensaje = paraPush({
    titulo: "Curso de Testing",
    cursoId: CURSO_ID,
    destinatario: destinatariosPushDePagina(1)[0],
    siteUrl: "https://taudux.com",
  });
  assert.doesNotMatch(mensaje.title, /\b(querés|podés|dejá|tenés|sabés)\b/i);
  assert.doesNotMatch(mensaje.body, /\b(querés|podés|dejá|tenés|sabés)\b/i);
});

test("trocearLotePush parte en tandas de 100, que es el máximo que acepta Expo", async () => {
  const { trocearLotePush, MAX_MENSAJES_EXPO } = await enviarPushModule;
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
  const { tokensNoRegistrados } = await enviarPushModule;
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
  const calls = { rpc: [], logs: [], fetches: [], deletes: [] };
  const jobs = [...(options.jobs ?? [])];
  const pages = [...(options.pages ?? [])];
  let fetchCallCount = 0;

  const serviceClient = {
    from(table) {
      return {
        delete() {
          return {
            async in(column, values) {
              calls.deletes.push({ table, column, values });
              return { error: options.deleteError || null };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (name === "claim_curso_anuncio") {
        return { data: jobs.length ? [jobs.shift()] : [], error: options.claimError || null };
      }
      if (name === "destinatarios_curso_anuncio" || name === "destinatarios_push_curso_anuncio") {
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
      // Expo answers with one ticket per message; Resend's body is never read.
      const tickets = options.expoTickets?.[fetchCallCount - 1] ?? null;
      return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
          if (tickets === null) return {};
          return { data: tickets };
        },
      };
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
    jobs: [{ curso_id: CURSO_ID, canal: "email", titulo: "Curso X", claim_token: CLAIM_TOKEN, claim_generation: 1, ultimo_destinatario: null, attempt_count: 1 }],
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
    jobs: [{ curso_id: CURSO_ID, canal: "email", titulo: "Curso X", claim_token: CLAIM_TOKEN, claim_generation: 1, ultimo_destinatario: null, attempt_count: 1 }],
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
    jobs: [{ curso_id: CURSO_ID, canal: "email", titulo: "Curso X", claim_token: CLAIM_TOKEN, claim_generation: 1, ultimo_destinatario: null, attempt_count: 1 }],
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
    jobs: [{ curso_id: CURSO_ID, canal: "email", titulo: "Curso X", claim_token: CLAIM_TOKEN, claim_generation: 1, ultimo_destinatario: null, attempt_count: 1 }],
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
    jobs: [{ curso_id: CURSO_ID, canal: "email", titulo: "Curso X", claim_token: CLAIM_TOKEN, claim_generation: 1, ultimo_destinatario: null, attempt_count: 1 }],
    pages: [destinatariosDePagina(5)],
    fetchStatuses: [200],
  });
  await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.ok(calls.logs.length > 0);
  for (const log of calls.logs) {
    assert.doesNotMatch(log.value, /@/);
  }
});

function jobPush(overrides = {}) {
  return {
    curso_id: CURSO_ID,
    canal: "push",
    titulo: "Curso X",
    claim_token: CLAIM_TOKEN,
    claim_generation: 1,
    ultimo_destinatario: null,
    attempt_count: 1,
    ...overrides,
  };
}

test("un anuncio de canal push va a Expo y no toca Resend", async () => {
  const { handler, calls } = await createHarness({
    jobs: [jobPush()],
    pages: [destinatariosPushDePagina(3)],
    fetchStatuses: [200],
  });
  const response = await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.equal(response.status, 200);
  const body = await payload(response);
  assert.equal(body.sent, 1);
  assert.equal(body.failures, 0);
  assert.equal(body.recipients, 3);

  assert.equal(calls.fetches.length, 1);
  assert.match(calls.fetches[0].url, /exp\.host/);
  assert.doesNotMatch(calls.fetches[0].url, /resend/);
  const mensajes = JSON.parse(calls.fetches[0].body);
  assert.equal(mensajes.length, 3);
  assert.equal(mensajes[0].channelId, "course-announcements");

  // Pide destinatarios push, no los de correo.
  assert.ok(calls.rpc.some((call) => call.name === "destinatarios_push_curso_anuncio"));
  assert.ok(!calls.rpc.some((call) => call.name === "destinatarios_curso_anuncio"));
  assert.equal(calls.rpc.filter((call) => call.name === "completar_curso_anuncio").length, 1);
});

test("el canal push descarta los tokens null que produce el left join", async () => {
  const conHuecos = [
    { id: makeId(1), expo_push_token: "ExponentPushToken[vivo-1]" },
    { id: makeId(2), expo_push_token: null },
    { id: makeId(3), expo_push_token: "ExponentPushToken[vivo-2]" },
  ];
  const { handler, calls } = await createHarness({
    jobs: [jobPush()],
    pages: [conHuecos],
    fetchStatuses: [200],
  });
  const response = await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  const body = await payload(response);
  // Sólo dos tokens se envían, pero el cursor avanza sobre las TRES filas: el
  // usuario sin app ya fue escaneado y no debe revisitarse.
  assert.equal(body.recipients, 2);
  const mensajes = JSON.parse(calls.fetches[0].body);
  assert.equal(mensajes.length, 2);
  const avanzar = calls.rpc.find((call) => call.name === "avanzar_curso_anuncio");
  assert.equal(avanzar.args.p_ultimo, makeId(3));
});

test("una página con más de 100 tokens se trocea en varios requests a Expo", async () => {
  // 60 usuarios con dos dispositivos cada uno: 120 tokens de una sola página.
  const multiDispositivo = Array.from({ length: 60 }, (_, index) => [
    { id: makeId(index + 1), expo_push_token: `ExponentPushToken[u${index}-a]` },
    { id: makeId(index + 1), expo_push_token: `ExponentPushToken[u${index}-b]` },
  ]).flat();
  const { handler, calls } = await createHarness({
    jobs: [jobPush()],
    pages: [multiDispositivo],
    fetchStatuses: [200, 200],
  });
  const response = await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  const body = await payload(response);
  assert.equal(body.recipients, 120);
  assert.equal(calls.fetches.length, 2, "Expo rechaza más de 100 mensajes por request");
  assert.equal(JSON.parse(calls.fetches[0].body).length, 100);
  assert.equal(JSON.parse(calls.fetches[1].body).length, 20);
});

test("un token DeviceNotRegistered se borra de push_devices sin reintentar el anuncio", async () => {
  const { handler, calls } = await createHarness({
    jobs: [jobPush()],
    pages: [destinatariosPushDePagina(3)],
    fetchStatuses: [200],
    expoTickets: [[
      { status: "ok", id: "ticket-1" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "error", details: { error: "MessageRateExceeded" } },
    ]],
  });
  const response = await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  const body = await payload(response);

  // La app desinstalada de un usuario no es un fallo del anuncio: los otros dos
  // mensajes salieron, así que el anuncio completa igual.
  assert.equal(body.sent, 1);
  assert.equal(body.failures, 0);
  assert.ok(!calls.rpc.some((call) => call.name === "reintentar_curso_anuncio"));

  assert.equal(calls.deletes.length, 1);
  assert.equal(calls.deletes[0].table, "push_devices");
  assert.equal(calls.deletes[0].column, "expo_push_token");
  // MessageRateExceeded es transitorio: ese token sigue vivo y no se borra.
  assert.deepEqual(calls.deletes[0].values, ["ExponentPushToken[user2]"]);
});

test("si falla el borrado de tokens muertos el anuncio igual completa", async () => {
  const { handler, calls } = await createHarness({
    jobs: [jobPush()],
    pages: [destinatariosPushDePagina(2)],
    fetchStatuses: [200],
    deleteError: { message: "boom" },
    expoTickets: [[
      { status: "ok", id: "ticket-1" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]],
  });
  const response = await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  const body = await payload(response);
  // La limpieza es housekeeping: no puede tumbar un anuncio que sí se envió.
  assert.equal(body.sent, 1);
  assert.equal(body.failures, 0);
  assert.ok(!calls.rpc.some((call) => call.name === "reintentar_curso_anuncio"));
});

test("un fallo HTTP de Expo reintenta el anuncio sin completarlo", async () => {
  const { handler, calls } = await createHarness({
    jobs: [jobPush()],
    pages: [destinatariosPushDePagina(3)],
    fetchStatuses: [500],
  });
  const response = await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  const body = await payload(response);
  assert.equal(body.sent, 0);
  assert.equal(body.failures, 1);
  assert.ok(!calls.rpc.some((call) => call.name === "completar_curso_anuncio"));
  const reintentar = calls.rpc.find((call) => call.name === "reintentar_curso_anuncio");
  assert.ok(reintentar);
  assert.match(reintentar.args.p_sanitized_error, /expo/);
});

// Regresión del incidente del 2026-08-04: las cuatro funciones de la cola
// filtran su UPDATE por `canal = p_canal` (0022:374), con default 'email'. El
// edge function no mandaba p_canal, así que para un job push el UPDATE buscaba
// la fila email, no coincidía con nada, devolvía false, y el código lo leía como
// fallo. La fila quedaba en 'processing' y el claim por rancidez la reenviaba
// cada 5 minutos: llegó a attempt_count = 201 en producción.
function argsDe(calls, nombre) {
  const call = calls.rpc.find((entry) => entry.name === nombre);
  assert.ok(call, `se esperaba una llamada a ${nombre}`);
  return call.args;
}

test("un job push manda p_canal 'push' al avanzar y al completar", async () => {
  const { handler, calls } = await createHarness({
    jobs: [jobPush()],
    pages: [destinatariosPushDePagina(3)],
    fetchStatuses: [200],
  });
  await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.equal(argsDe(calls, "avanzar_curso_anuncio").p_canal, "push");
  assert.equal(argsDe(calls, "completar_curso_anuncio").p_canal, "push");
});

test("un job email manda p_canal 'email' explícito en vez de confiar en el default", async () => {
  const { handler, calls } = await createHarness({
    jobs: [{ curso_id: CURSO_ID, canal: "email", titulo: "Curso X", claim_token: CLAIM_TOKEN, claim_generation: 1, ultimo_destinatario: null, attempt_count: 1 }],
    pages: [destinatariosDePagina(5)],
    fetchStatuses: [200],
  });
  await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.equal(argsDe(calls, "avanzar_curso_anuncio").p_canal, "email");
  assert.equal(argsDe(calls, "completar_curso_anuncio").p_canal, "email");
});

test("un job push que falla al enviar manda p_canal 'push' al reintentar", async () => {
  const { handler, calls } = await createHarness({
    jobs: [jobPush()],
    pages: [destinatariosPushDePagina(3)],
    fetchStatuses: [500],
  });
  await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.equal(argsDe(calls, "reintentar_curso_anuncio").p_canal, "push");
});

test("un job push sin presupuesto manda p_canal 'push' al pausar", async () => {
  // Página llena (100) para que no sea la última y el loop vuelva a evaluar el
  // presupuesto; el reloj salta al segundo ciclo, igual que el test de email.
  const { handler, calls } = await createHarness({
    jobs: [jobPush()],
    pages: [destinatariosPushDePagina(100), destinatariosPushDePagina(30, 100)],
    fetchStatuses: [200, 200],
    nowValues: [0, 0, 0, 41000, 41000, 41000, 41000, 41000, 41000, 41000],
  });
  await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.equal(argsDe(calls, "pausar_curso_anuncio").p_canal, "push");
});

test("un job push cuyo lookup de destinatarios falla manda p_canal 'push' al reintentar", async () => {
  const { handler, calls } = await createHarness({
    jobs: [jobPush()],
    pages: [[]],
    pageError: { message: "boom" },
  });
  await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.equal(argsDe(calls, "reintentar_curso_anuncio").p_canal, "push");
});

test("un job push que no logra persistir el cursor manda p_canal 'push' al reintentar", async () => {
  // Éste es el camino exacto del incidente: avanzar_curso_anuncio devolvía
  // false porque el UPDATE no encontraba la fila, y el reintento fallaba igual.
  const { handler, calls } = await createHarness({
    jobs: [jobPush()],
    pages: [destinatariosPushDePagina(3)],
    fetchStatuses: [200],
    avanzarResult: false,
  });
  await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.equal(argsDe(calls, "avanzar_curso_anuncio").p_canal, "push");
  assert.equal(argsDe(calls, "reintentar_curso_anuncio").p_canal, "push");
});

test("el log del canal push nunca filtra un token de Expo", async () => {
  const { handler, calls } = await createHarness({
    jobs: [jobPush()],
    pages: [destinatariosPushDePagina(3)],
    fetchStatuses: [200],
    expoTickets: [[
      { status: "ok", id: "ticket-1" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "ok", id: "ticket-3" },
    ]],
  });
  await handler(notifyRequest({ origin: undefined, authorization: undefined, cronSecret: CRON_SECRET }));
  assert.ok(calls.logs.length > 0);
  for (const log of calls.logs) {
    assert.doesNotMatch(log.value, /ExponentPushToken/);
  }
});

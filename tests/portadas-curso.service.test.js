const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { File } = require("node:buffer");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SERVICE_PATH = "src/app/core/cursos/portadas-curso.service.js";
const FUNCTION_PATH = "supabase/functions/upload-course-cover/index.ts";
const VALIDATION_PATH = "supabase/functions/upload-course-cover/validation.mjs";
const MIGRATION_PATH = "supabase/migrations/0011_portadas_cursos_storage.sql";
const CLEANUP_MIGRATION_PATH = "supabase/migrations/0012_secure_course_cover_cleanup.sql";
const BUCKET_LIMIT_MIGRATION_PATH = "supabase/migrations/0013_course_cover_bucket_limit.sql";
const BUCKET_LIMIT_TEST_PATH = "supabase/tests/0013_course_cover_bucket_limit.test.sql";
const MIGRATIONS_PATH = "supabase/migrations";
const OLD_MIGRATIONS_PATH = ".kiro/supabase/migrations";
const FORM_PATH = "src/app/features/courses/gestionar-curso.js";
const FORM_COVER_PATH = "src/app/features/courses/gestionar-curso.portada.js";
const FORM_CATEGORIES_PATH = "src/app/features/courses/gestionar-curso.categorias.js";
const FORM_HTML_PATH = "src/app/features/courses/editar-curso.html";
/*
  No hay manifiesto de hashes de migraciones acá, y es a propósito: no lo
  vuelvas a agregar.

  Existió uno (un SHA-256 por archivo de supabase/migrations/) desde el commit
  424cf87, y su motivo era puntual: atestiguar que los archivos mudados de
  .kiro/supabase/migrations/ a supabase/migrations/ habían llegado byte a byte
  idénticos y sin dejar ninguno atrás. Esa mudanza terminó hace rato.

  Sobrevivió a su propósito y sólo cobraba peaje. En 20 commits de este archivo
  nunca detectó una edición no autorizada: la única vez que reflejó un cambio a
  una migración existente (0009) era un comentario en español. En cambio sí dio
  un falso positivo de 18 migraciones de golpe en un clon fresco en Windows, por
  CRLF, que hubo que apagar con .gitattributes. Y 13 de esos 20 commits eran
  puro trámite de tres líneas, arrastrando este test de portadas a cambios sobre
  push devices o login con Google.

  Tampoco era la barrera que aparentaba: el hash no distinguía una migración ya
  aplicada en producción de una que no, y se satisfacía pegando el hash nuevo —
  exactamente lo que pasó con 0009. Contra editar una migración ya aplicada, lo
  que protege es el runbook, no un test.

  Lo que sí se garantiza abajo es el LAYOUT, derivado del disco: numeración
  contigua desde 0001 sin huecos, versiones únicas y nada de subdirectorios.
  Agregar una migración no requiere tocar este archivo.
*/
const SERVICE_SOURCE = fs.readFileSync(SERVICE_PATH, "utf8");
const FUNCTION_SOURCE = fs.readFileSync(FUNCTION_PATH, "utf8");
const MIGRATION_SOURCE = fs.readFileSync(MIGRATION_PATH, "utf8");
const CLEANUP_MIGRATION_SOURCE = fs.readFileSync(CLEANUP_MIGRATION_PATH, "utf8");
const CONTROLLER_SOURCE = fs.readFileSync(FORM_PATH, "utf8");
const FORM_COVER_SOURCE = fs.readFileSync(FORM_COVER_PATH, "utf8");
// The form is split across a controller and its cover/category modules; the
// contracts below hold over the screen as a whole.
const FORM_SOURCE = [
  CONTROLLER_SOURCE,
  FORM_COVER_SOURCE,
  fs.readFileSync(FORM_CATEGORIES_PATH, "utf8"),
].join("\n");
const FORM_HTML_SOURCE = fs.readFileSync(FORM_HTML_PATH, "utf8");
const BROWSER_SOURCE = fs.readdirSync("src", { recursive: true })
  .filter((file) => /\.(?:html|js)$/.test(file))
  .map((file) => fs.readFileSync(path.join("src", file), "utf8")).join("\n");
const validation = import(pathToFileURL(path.resolve(VALIDATION_PATH)).href);
const endpoint = import(pathToFileURL(path.resolve(FUNCTION_PATH)).href);
const { crearClientePortadas, crearFlujoMutacionCurso } = require(path.resolve(SERVICE_PATH));
const { crearDatosEnvioCurso } = require(path.resolve(FORM_PATH));
const { crearEstadoPortadaEdicion } = require(path.resolve(FORM_COVER_PATH));

const ORIGIN = "https://taudux.com";
const PROJECT_URL = "https://yqkvgfqplmbbcebrivpt.supabase.co";
const MANAGED_PATH = `sha256/${"a".repeat(64)}.png`;
const MANAGED_URL = `${PROJECT_URL}/storage/v1/object/public/course-covers/${MANAGED_PATH}`;
const ASSOCIATION_TOKEN = "123e4567-e89b-42d3-a456-426614174222";
const PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
));
const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0,
  0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 1, 0xff, 0xd9,
]);
const GENERATED_JPEG = JPEG.slice();
GENERATED_JPEG[7] = 0x03; GENERATED_JPEG[8] = 0x84;
GENERATED_JPEG[9] = 0x04; GENERATED_JPEG[10] = 0xb0;
const CHROME_CANVAS_JPEG = new Uint8Array(fs.readFileSync(
  "tests/fixtures/course-cover-canvas-1200x900.jpg"
));
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20, 10, 0, 0, 0, 0x10, 0, 0, 0x9d, 1, 0x2a, 1, 0, 1, 0,
]);
const WEBP_LOSSLESS = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 18, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0,
]);
const WEBP_EXTENDED = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 40, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, ...new Uint8Array(10),
  ...WEBP.slice(12),
]);

function selectedFile(name = "cover.png", type = "image/png", bytes = PNG) {
  return new File([bytes], name, { type, lastModified: 1 });
}

function generatedFile() {
  return selectedFile("course-cover.jpg", "image/jpeg", GENERATED_JPEG);
}

function uploadRequest(options = {}) {
  const origin = Object.hasOwn(options, "origin") ? options.origin : ORIGIN;
  const token = Object.hasOwn(options, "token") ? options.token : "Bearer current-user";
  const file = Object.hasOwn(options, "file") ? options.file : selectedFile("course-cover.jpg", "image/jpeg", GENERATED_JPEG);
  const { files, method = "POST" } = options;
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  if (token !== undefined) headers.authorization = token;
  if (method === "OPTIONS") return new Request("https://edge.test/upload", { method, headers });
  const body = new FormData();
  for (const entry of files || (file === undefined ? [] : [file])) body.append("file", entry);
  return new Request("https://edge.test/upload", { method, headers, body });
}

async function json(response) {
  return JSON.parse(await response.text());
}

async function createEndpointHarness(options = {}) {
  const { createUploadCourseCoverHandler } = await endpoint;
  const calls = { order: [], uploads: [], publicPaths: [], logs: [], fetches: [], rpc: [] };
  const uploadError = options.uploadError || null;
  const bucket = {
    async upload(objectPath, bytes, uploadOptions) {
      calls.order.push("upload");
      calls.uploads.push({ objectPath, bytes, uploadOptions });
      if (options.uploadThrows) throw new Error("provider upload secret");
      return { error: uploadError };
    },
    getPublicUrl(objectPath) {
      calls.publicPaths.push(objectPath);
      const publicUrl = options.publicUrl === undefined
        ? `${PROJECT_URL}/storage/v1/object/public/course-covers/${objectPath}`
        : options.publicUrl;
      return { data: { publicUrl } };
    },
  };
  const dependencies = {
    getEnv(name) {
      return {
        SUPABASE_URL: PROJECT_URL,
        SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: options.missingServiceRole ? undefined : "server-secret",
      }[name];
    },
    async createServiceClient() {
      calls.order.push("service");
      if (options.serviceThrows) throw new Error("provider Bearer secret path sha256/deadbeef");
      return {
        async rpc(name, args) {
          calls.order.push(name);
          calls.rpc.push({ name, args });
          if (name === "begin_course_cover_upload") {
            return options.beginError
              ? { data: null, error: true }
              : { data: [{ association_token: ASSOCIATION_TOKEN }], error: null };
          }
          if (name === "complete_course_cover_upload") {
            return { data: options.completeResult ?? true, error: options.completeError || null };
          }
          if (name === "cancel_course_cover_upload") return { data: true, error: null };
          throw new Error(`unexpected RPC ${name}`);
        },
        storage: { from(name) {
          calls.order.push("storage");
          assert.equal(name, "course-covers");
          return bucket;
        } },
      };
    },
    logger: {
      info(value) { calls.logs.push({ level: "info", value }); },
      error(value) { calls.logs.push({ level: "error", value }); },
    },
    now: (() => { let value = 0; return () => (value += 7); })(),
  };
  if (options.defaultCaller) {
    dependencies.fetchImpl = async (url, init) => {
      calls.fetches.push({ url, init });
      calls.order.push(url.includes("/auth/") ? "getUser" : "es_admin");
      return url.includes("/auth/")
        ? new Response(JSON.stringify({ id: "user-id" }), { status: 200 })
        : new Response("true", { status: 200 });
    };
  } else {
    dependencies.createCallerClient = () => {
      calls.order.push("caller");
      return {
        auth: { async getUser() {
          calls.order.push("getUser");
          if (options.authThrows) throw new Error("JWT provider-secret@example.com");
          return options.invalidUser
            ? { data: { user: null }, error: true }
            : { data: { user: { id: "user-id" } }, error: null };
        } },
        async rpc(name) {
          calls.order.push("es_admin");
          assert.equal(name, "es_admin");
          if (options.adminError) return { data: null, error: true };
          return { data: options.admin === false ? false : true, error: null };
        },
      };
    };
  }
  return { calls, handler: createUploadCourseCoverHandler(dependencies) };
}

function assertTelemetry(calls, level, code, status) {
  assert.equal(calls.logs.length, 1);
  assert.equal(calls.logs[0].level, level);
  const event = JSON.parse(calls.logs[0].value);
  assert.deepEqual(Object.keys(event).sort(), ["code", "durationMs", "event", "status"].sort());
  assert.equal(event.event, "upload_course_cover");
  assert.equal(event.code, code);
  assert.equal(event.status, status);
  assert.equal(event.durationMs, 7);
  assert.equal(Object.hasOwn(event, "errorRateThresholdsPercent"), false);
}

function assertValidationTelemetry(calls) {
  assert.equal(calls.logs.length, 1);
  assert.equal(calls.logs[0].level, "error");
  const event = JSON.parse(calls.logs[0].value);
  assert.deepEqual(event, {
    event: "upload_course_cover",
    code: "invalid_image",
    status: 400,
    durationMs: 7,
  });
  assert.doesNotMatch(calls.logs[0].value,
    /bytes|file|name|mime|width|height|authorization|auth|session|user|url|email|phone|address|Bearer|course-cover\.jpg/i);
}

test("validates structural JPEG, PNG, and all required WebP headers with deterministic paths", async () => {
  const { inspectImage, contentPath } = await validation;
  for (const [bytes, mime, extension] of [
    [JPEG, "image/jpeg", "jpg"],
    [PNG, "image/png", "png"],
    [WEBP, "image/webp", "webp"],
    [WEBP_LOSSLESS, "image/webp", "webp"],
    [WEBP_EXTENDED, "image/webp", "webp"],
  ]) {
    assert.deepEqual(inspectImage(bytes, mime), { width: 1, height: 1, extension, mime });
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(await contentPath(bytes, extension), `sha256/${hash}.${extension}`);
  }
});

test("rejects spoofing, truncation, dimensions, pixel cap, MIME mismatch, and oversize content", async () => {
  const { inspectImage, MAX_FILE_BYTES } = await validation;
  assert.throws(() => inspectImage(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), "image/jpeg"));
  for (const [bytes, mime] of [[JPEG, "image/jpeg"], [PNG, "image/png"], [WEBP, "image/webp"]]) {
    assert.throws(() => inspectImage(bytes.slice(0, -1), mime));
  }
  const badJpeg = JPEG.slice(); badJpeg[9] = 0x20; badJpeg[10] = 1;
  const badPng = PNG.slice(); badPng.set([0, 0, 0x20, 1], 16);
  const badWebp = WEBP.slice(); badWebp[26] = 1; badWebp[27] = 0x20;
  assert.throws(() => inspectImage(badJpeg, "image/jpeg"));
  assert.throws(() => inspectImage(badPng, "image/png"));
  assert.throws(() => inspectImage(badWebp, "image/webp"));
  const tooManyPixels = PNG.slice(); tooManyPixels.set([0, 0, 0x20, 0, 0, 0, 0x20, 0], 16);
  assert.throws(() => inspectImage(tooManyPixels, "image/png"));
  assert.throws(() => inspectImage(PNG, "image/jpeg"));
  assert.throws(() => inspectImage(new Uint8Array(MAX_FILE_BYTES + 1), "image/png"));
});

test("browser invocation has a hard aborting deadline and ignores late completion", async () => {
  let fireTimeout;
  let cleared;
  let invokeOptions;
  let resolveInvoke;
  let settled = "pending";
  const invocation = new Promise((resolve) => { resolveInvoke = resolve; });
  const service = crearClientePortadas({
    client: { functions: { invoke(name, options) {
      assert.equal(name, "upload-course-cover");
      invokeOptions = options;
      return invocation;
    } } },
    timeoutMs: 15_000,
    setTimer(callback) { fireTimeout = callback; return 91; },
    clearTimer(id) { cleared = id; },
    AbortControllerImpl: AbortController,
  });
  const observed = service.subir(generatedFile()).then(
    () => { settled = "success"; },
    (error) => { settled = error.message; }
  );
  fireTimeout();
  await observed;
  assert.match(settled, /tardó demasiado/);
  assert.equal(invokeOptions.signal.aborted, true);
  assert.equal(cleared, 91);
  assert.ok(invokeOptions.body instanceof FormData);
  resolveInvoke({ data: { ok: true, url: "https://late.example/cover.png" }, error: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(settled, /tardó demasiado/);
});

test("browser successful invocation sends FormData, signal, and clears its timer", async () => {
  let options;
  let cleared;
  const service = crearClientePortadas({
    client: { functions: { async invoke(name, invocationOptions) {
      assert.equal(name, "upload-course-cover");
      options = invocationOptions;
      return { data: { ok: true, url: MANAGED_URL, path: MANAGED_PATH, associationToken: ASSOCIATION_TOKEN }, error: null };
    } } },
    setTimer: () => 37,
    clearTimer: (id) => { cleared = id; },
    AbortControllerImpl: AbortController,
  });
  assert.deepEqual(await service.subir(generatedFile()), {
    url: MANAGED_URL,
    path: MANAGED_PATH,
    associationToken: ASSOCIATION_TOKEN,
  });
  assert.ok(options.body instanceof FormData);
  assert.equal(options.body.getAll("file").length, 1);
  assert.equal(options.signal.aborted, false);
  assert.equal(cleared, 37);
});

test("browser maps function outcomes without exposing remote details", async () => {
  const responses = [
    [{ data: null, error: { context: { json: async () => ({ code: "auth_required", message: "secret" }) } } }, "auth_required", "Tu sesión expiró. Inicia sesión nuevamente."],
    [{ data: { ok: false, code: "forbidden" }, error: null }, "forbidden", "No tienes permisos para subir portadas."],
    [{ data: { ok: false, code: "invalid_request" }, error: null }, "invalid_request", "No se pudo procesar la solicitud de portada. Inténtalo de nuevo."],
    [{ data: { ok: false, code: "invalid_image" }, error: null }, "invalid_image", "La portada generada no es un JPEG válido de 1200 × 900."],
    [{ data: { ok: false, code: "upload_failed" }, error: null }, "upload_failed", "No se pudo subir la portada. Revisa tu conexión e inténtalo de nuevo."],
  ];
  for (const [response, expectedCode, expectedMessage] of responses) {
    let cleared = false;
    const service = crearClientePortadas({
      client: { functions: { invoke: async () => response } },
      setTimer: () => 1,
      clearTimer: () => { cleared = true; },
      AbortControllerImpl: AbortController,
    });
    await assert.rejects(service.subir(generatedFile()), (error) => {
      assert.equal(error.code, expectedCode);
      assert.equal(error.message, expectedMessage);
      return true;
    });
    assert.equal(cleared, true);
  }
});

test("generated upload client accepts only a non-empty JPEG within the 10 MB result limit", async () => {
  const accepted = selectedFile("course-cover.jpg", "image/jpeg", GENERATED_JPEG);
  const invocations = [];
  const service = crearClientePortadas({
    client: { functions: { async invoke(_name, options) {
      invocations.push(options.body.get("file"));
      return { data: { ok: true, url: MANAGED_URL.replace(/\.png$/, ".jpg"), path: MANAGED_PATH.replace(/\.png$/, ".jpg"), associationToken: ASSOCIATION_TOKEN }, error: null };
    } } },
    setTimer: () => 1,
    clearTimer() {},
    AbortControllerImpl: AbortController,
  });
  await service.subir(accepted);
  assert.equal(invocations[0], accepted);
  await assert.rejects(service.subir(selectedFile()), /JPEG generada/i);
  await assert.rejects(service.subir(new File([new Uint8Array(10_000_001)], "course-cover.jpg", { type: "image/jpeg" })), /10 MB/);
});

test("admin edit submission preserves its loaded cover without consulting external URL fields", async () => {
  const portadaExistente = "https://legacy.example/existing-cover.png";
  let lecturasUrlExterna = 0;
  const valoresFormulario = {
    titulo: " Curso editado ",
    datosCategoria: {
      categoria_id: "category-1",
      categoria: "Análisis de datos",
      categoria_modo: "normalizado",
    },
    descripcion: " Descripción editada ",
    modalidad: "en_linea",
    fechaInicio: "2026-08-01",
    fechaFin: "2026-08-31",
    proximamente: false,
    diasSemana: ["lun"],
    horaInicio: "10:00",
    duracionHoras: "2",
    cupoMaximo: "20",
    costo: "500",
    instructor: " Docente ",
  };
  Object.defineProperties(valoresFormulario, {
    imagen_url: {
      enumerable: true,
      get() {
        lecturasUrlExterna++;
        return "https://administrator.example/entered-cover.png";
      },
    },
    cursoImagen: {
      enumerable: true,
      get() {
        lecturasUrlExterna++;
        return "https://administrator.example/other-cover.png";
      },
    },
  });

  const datos = crearDatosEnvioCurso(valoresFormulario, { imagen_url: portadaExistente });
  const actualizaciones = [];
  const flow = crearFlujoMutacionCurso({
    subirPortada: async () => { throw new Error("no file means no upload"); },
    crearCurso: async () => { throw new Error("edit submission must not create"); },
    actualizarCurso: async (id, campos) => {
      actualizaciones.push({ id, campos });
      return { ok: true };
    },
    generarOperacionId: () => "unused-on-edit",
  });
  const resultado = await flow.ejecutar({
    cursoId: "course-1",
    datos,
    archivoPortada: null,
    portadaEsperada: { url: portadaExistente, path: null },
    firma: "edit-without-selected-file",
    controles: [],
  });

  assert.equal(resultado.ok, true);
  assert.equal(lecturasUrlExterna, 0);
  assert.equal(actualizaciones.length, 1);
  assert.equal(actualizaciones[0].id, "course-1");
  assert.equal(actualizaciones[0].campos.imagen_url, portadaExistente);
  assert.equal(actualizaciones[0].campos.imagen_storage_path, null);
  assert.equal(Object.hasOwn(actualizaciones[0].campos, "cursoImagen"), false);
});

test("shared form workflow uploads local covers and preserves an existing cover without a file", async () => {
  const controls = [{ disabled: false }, { disabled: true }, { disabled: false }];
  const calls = [];
  const flow = crearFlujoMutacionCurso({
    subirPortada: async () => {
      assert.ok(controls.every((control) => control.disabled));
      calls.push("upload");
      return { url: MANAGED_URL, path: MANAGED_PATH, associationToken: ASSOCIATION_TOKEN };
    },
    crearCurso: async (datos, id) => {
      assert.ok(controls.every((control) => control.disabled));
      calls.push({ action: "create", datos, id });
      return { ok: true };
    },
    actualizarCurso: async (id, datos) => {
      assert.ok(controls.every((control) => control.disabled));
      calls.push({ action: "update", id, datos });
      return { ok: true };
    },
    generarOperacionId: () => "operation-1",
  });
  const created = await flow.ejecutar({
    cursoId: null,
    datos: { titulo: "Curso", imagen_url: "" },
    archivoPortada: selectedFile(),
    firma: "create-a",
    controles: controls,
  });
  assert.equal(created.ok, true);
  assert.equal(calls[0], "upload");
  assert.equal(calls[1].action, "create");
  assert.equal(calls[1].datos.imagen_url, MANAGED_URL);
  assert.equal(calls[1].datos.imagen_storage_path, MANAGED_PATH);
  assert.equal(calls[1].datos.imagen_upload_token, ASSOCIATION_TOKEN);
  assert.equal(calls[1].id, "operation-1");
  assert.deepEqual(controls.map((control) => control.disabled), [false, true, false]);
  calls.length = 0;
  await flow.ejecutar({
    cursoId: "course-1",
    datos: { titulo: "Editado", imagen_url: "https://legacy.example/cover.png" },
    archivoPortada: selectedFile(),
    portadaEsperada: { url: "https://legacy.example/cover.png", path: null },
    firma: "edit-local",
    controles: controls,
  });
  assert.equal(calls[0], "upload");
  assert.equal(calls[1].action, "update");
  assert.equal(calls[1].datos.imagen_url, MANAGED_URL);
  assert.equal(calls[1].datos.imagen_storage_path, MANAGED_PATH);
  calls.length = 0;
  await flow.ejecutar({
    cursoId: "course-1",
    datos: { titulo: "Editado", imagen_url: "https://legacy.example/cover.png" },
    archivoPortada: null,
    portadaEsperada: { url: "https://legacy.example/cover.png", path: null },
    firma: "edit-without-cover",
    controles: controls,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "update");
  assert.equal(calls[0].datos.imagen_url, "https://legacy.example/cover.png");
});

test("shared form workflow blocks DB after upload failure and warns after DB failure", async () => {
  const controls = [{ disabled: false }, { disabled: true }];
  let databaseCalls = 0;
  const typedUploadError = Object.assign(new Error("No se pudo procesar la solicitud de portada. Inténtalo de nuevo."), {
    code: "invalid_request",
  });
  let uploadAttempts = 0;
  const uploadFailure = crearFlujoMutacionCurso({
    subirPortada: async () => { uploadAttempts++; throw typedUploadError; },
    crearCurso: async () => { databaseCalls++; return { ok: true }; },
    actualizarCurso: async () => { databaseCalls++; return { ok: true }; },
    generarOperacionId: () => "operation-1",
  });
  const failedUpload = await uploadFailure.ejecutar({
    cursoId: null, datos: { titulo: "Curso" }, archivoPortada: selectedFile(), firma: "a", controles: controls,
  });
  assert.equal(failedUpload.ok, false);
  assert.equal(failedUpload.etapa, "upload");
  assert.equal(failedUpload.codigo, "invalid_request");
  assert.equal(failedUpload.mensajeUsuario, typedUploadError.message);
  assert.equal(uploadAttempts, 1);
  assert.equal(databaseCalls, 0);
  assert.deepEqual(controls.map((control) => control.disabled), [false, true]);

  const databaseFailure = crearFlujoMutacionCurso({
    subirPortada: async () => ({ url: MANAGED_URL, path: MANAGED_PATH, associationToken: ASSOCIATION_TOKEN }),
    crearCurso: async () => ({ ok: false, ambigua: true, mensaje: "No se confirmó el curso." }),
    actualizarCurso: async () => ({ ok: false }),
    generarOperacionId: () => "operation-2",
  });
  const failedDatabase = await databaseFailure.ejecutar({
    cursoId: null, datos: { titulo: "Curso" }, archivoPortada: selectedFile(), firma: "b", controles: controls,
  });
  assert.equal(failedDatabase.ok, false);
  assert.match(failedDatabase.mensajeUsuario, /limpieza manual en Supabase/);
  assert.deepEqual(controls.map((control) => control.disabled), [false, true]);
});

test("create response loss retains one UUID through in-flight edit and retry", async () => {
  const controls = [{ disabled: false, value: "original" }, { disabled: true }];
  const ids = ["operation-1", "operation-2"];
  const usedIds = [];
  let finishFirst;
  let attempt = 0;
  const flow = crearFlujoMutacionCurso({
    subirPortada: async () => null,
    crearCurso: async (_datos, id) => {
      usedIds.push(id);
      attempt++;
      if (attempt === 1) return new Promise((resolve) => { finishFirst = resolve; });
      return { ok: true };
    },
    actualizarCurso: async () => ({ ok: true }),
    generarOperacionId: () => ids.shift(),
  });
  const first = flow.ejecutar({
    cursoId: null, datos: { titulo: "Curso" }, archivoPortada: null, firma: "original", controles: controls,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(flow.estaEnCurso(), true);
  assert.ok(controls.every((control) => control.disabled));
  assert.equal(flow.invalidarOperacion("edited-in-flight"), false);
  let editEvents = 0;
  if (!controls[0].disabled) {
    editEvents++;
    controls[0].value = "edited";
  }
  assert.equal(editEvents, 0);
  assert.equal(controls[0].value, "original");
  finishFirst({ ok: false, ambigua: true, codigo: "create_confirmation_pending", mensaje: "Pendiente." });
  await first;
  assert.deepEqual(controls.map((control) => control.disabled), [false, true]);
  const retry = await flow.ejecutar({
    cursoId: null, datos: { titulo: "Curso" }, archivoPortada: null, firma: "edited-in-flight", controles: controls,
  });
  assert.equal(retry.ok, true);
  assert.deepEqual(usedIds, ["operation-1", "operation-1"]);
  assert.equal(ids.length, 1);
});

test("a genuine post-operation edit rotates the retained create UUID", async () => {
  const generated = ["operation-1", "operation-2"];
  const used = [];
  const flow = crearFlujoMutacionCurso({
    subirPortada: async () => null,
    crearCurso: async (_datos, id) => { used.push(id); return { ok: false, ambigua: true, mensaje: "Pendiente." }; },
    actualizarCurso: async () => ({ ok: true }),
    generarOperacionId: () => generated.shift(),
  });
  const args = { cursoId: null, datos: { titulo: "A" }, archivoPortada: null, firma: "A", controles: [] };
  await flow.ejecutar(args);
  assert.equal(flow.invalidarOperacion("B"), true);
  await flow.ejecutar({ ...args, datos: { titulo: "B" }, firma: "B" });
  assert.deepEqual(used, ["operation-1", "operation-2"]);
});

test("Edge handler executes CORS, method, and auth outcomes", async (t) => {
  await t.test("allowed preflight", async () => {
    const { calls, handler } = await createEndpointHarness();
    const response = await handler(uploadRequest({ method: "OPTIONS", token: undefined }));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
    assertTelemetry(calls, "info", "preflight_ok", 204);
  });
  await t.test("method not allowed", async () => {
    const { calls, handler } = await createEndpointHarness();
    const response = await handler(uploadRequest({ method: "PUT", token: undefined }));
    assert.equal(response.status, 405);
    assert.equal((await json(response)).code, "method_not_allowed");
    assert.deepEqual(calls.order, []);
    assertTelemetry(calls, "error", "method_not_allowed", 405);
  });
  for (const [name, origin] of [["unknown origin", "https://evil.example"], ["missing origin", undefined]]) {
    await t.test(name, async () => {
      const { calls, handler } = await createEndpointHarness();
      const response = await handler(uploadRequest({ origin }));
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assertTelemetry(calls, "error", "invalid_origin", 403);
    });
  }
  await t.test("missing JWT", async () => {
    const { calls, handler } = await createEndpointHarness();
    const response = await handler(uploadRequest({ token: undefined }));
    assert.equal(response.status, 401);
    assert.deepEqual(calls.order, []);
    assertTelemetry(calls, "error", "auth_required", 401);
  });
  await t.test("invalid JWT", async () => {
    const { calls, handler } = await createEndpointHarness({ invalidUser: true });
    const response = await handler(uploadRequest());
    assert.equal(response.status, 401);
    assert.deepEqual(calls.order, ["caller", "getUser"]);
    assertTelemetry(calls, "error", "auth_required", 401);
  });
  await t.test("non-admin", async () => {
    const { calls, handler } = await createEndpointHarness({ admin: false });
    const response = await handler(uploadRequest());
    assert.equal(response.status, 403);
    assert.deepEqual(calls.order, ["caller", "getUser", "es_admin"]);
    assertTelemetry(calls, "error", "forbidden", 403);
  });
});

test("Edge handler rejects invalid bodies and files before decoding or service access", async () => {
  const { calls, handler } = await createEndpointHarness();
  const invalidBody = new Request("https://edge.test/upload", {
    method: "POST",
    headers: { origin: ORIGIN, authorization: "Bearer current-user", "content-type": "application/json" },
    body: "{}",
  });
  let response = await handler(invalidBody);
  assert.equal(response.status, 400);
  assert.equal((await json(response)).code, "invalid_request");

  const pngHarness = await createEndpointHarness();
  response = await pngHarness.handler(uploadRequest({ file: selectedFile() }));
  assert.equal(response.status, 400);
  assert.equal((await json(response)).code, "invalid_image");
  assert.ok(!pngHarness.calls.order.includes("service"));
  assert.ok(!calls.order.includes("service"));

  const emptyHarness = await createEndpointHarness();
  response = await emptyHarness.handler(uploadRequest({ file: selectedFile("empty.png", "image/png", []) }));
  assert.equal(response.status, 400);
  assert.equal((await json(response)).code, "invalid_request");

  const duplicateHarness = await createEndpointHarness();
  response = await duplicateHarness.handler(uploadRequest({ files: [selectedFile(), selectedFile("second.png")] }));
  assert.equal(response.status, 400);
  assert.equal((await json(response)).code, "invalid_request");
});

test("native multipart preserves realistic Canvas acceptance and rejects invalid derivatives before effects", async () => {
  const accepted = await createEndpointHarness();
  const acceptedResponse = await accepted.handler(uploadRequest({
    file: selectedFile("course-cover.jpg", "image/jpeg", CHROME_CANVAS_JPEG),
  }));
  assert.equal(acceptedResponse.status, 200);
  assert.equal((await json(acceptedResponse)).ok, true);
  assert.ok(accepted.calls.order.includes("upload"));

  const dimensionMismatch = CHROME_CANVAS_JPEG.slice();
  const sof = dimensionMismatch.findIndex((byte, index) => byte === 0xff && dimensionMismatch[index + 1] === 0xc0);
  assert.ok(sof > 0, "fixture must contain a baseline JPEG SOF marker");
  dimensionMismatch[sof + 5] = 0x03;
  dimensionMismatch[sof + 6] = 0x83;

  for (const [name, type, bytes] of [
    ["malformed", "image/jpeg", Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)],
    ["truncated", "image/jpeg", CHROME_CANVAS_JPEG.slice(0, -1)],
    ["MIME mismatch", "image/png", CHROME_CANVAS_JPEG],
    ["dimension mismatch", "image/jpeg", dimensionMismatch],
  ]) {
    const rejected = await createEndpointHarness();
    const response = await rejected.handler(uploadRequest({ file: selectedFile("course-cover.jpg", type, bytes) }));
    assert.equal(response.status, 400, name);
    assert.equal((await json(response)).code, "invalid_image", name);
    assert.ok(!rejected.calls.order.includes("service"), name);
    assert.ok(!rejected.calls.order.includes("upload"), name);
  }
});

test("structural inspection is the whole server-side defense and never leaks details", async (t) => {
  const expectedResponse = { ok: false, code: "invalid_image", message: "The image is invalid." };
  const dimensionMismatch = CHROME_CANVAS_JPEG.slice();
  const sof = dimensionMismatch.findIndex((byte, index) => byte === 0xff && dimensionMismatch[index + 1] === 0xc0);
  assert.ok(sof > 0, "fixture must contain a baseline JPEG SOF marker");
  dimensionMismatch[sof + 5] = 0x03;
  dimensionMismatch[sof + 6] = 0x83;

  for (const [name, type, bytes] of [
    ["malformed", "image/jpeg", Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)],
    ["trailing bytes after EOI", "image/jpeg", Uint8Array.from([...CHROME_CANVAS_JPEG, 0x00])],
    ["truncated", "image/jpeg", CHROME_CANVAS_JPEG.slice(0, -1)],
    ["MIME mismatch", "image/png", CHROME_CANVAS_JPEG],
    ["dimension mismatch", "image/jpeg", dimensionMismatch],
  ]) {
    await t.test(name, async () => {
      const { calls, handler } = await createEndpointHarness();
      const response = await handler(uploadRequest({
        file: selectedFile("private-name.jpg", type, bytes),
      }));
      assert.equal(response.status, 400);
      assert.deepEqual(await json(response), expectedResponse);
      assertValidationTelemetry(calls);
      assert.ok(!calls.order.includes("service"));
      assert.ok(!calls.order.includes("upload"));
    });
  }
});

test("Edge success creates and completes a server upload intent around Storage upload", async () => {
  const { calls, handler } = await createEndpointHarness({ defaultCaller: true });
  const response = await handler(uploadRequest());
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.ok, true);
  assert.match(body.url, /^https:\/\/yqkvgfqplmbbcebrivpt\.supabase\.co\/storage\/v1\/object\/public\/course-covers\/sha256\/[0-9a-f]{64}\.jpg$/);
  assert.match(body.path, /^sha256\/[0-9a-f]{64}\.jpg$/);
  assert.equal(body.associationToken, ASSOCIATION_TOKEN);
  assert.deepEqual(calls.order, [
    "getUser",
    "es_admin",
    "service",
    "storage",
    "begin_course_cover_upload",
    "upload",
    "complete_course_cover_upload",
  ]);
  assert.equal(calls.fetches.length, 2);
  assert.equal(calls.fetches[0].init.headers.Authorization, "Bearer current-user");
  assert.equal(calls.fetches[1].init.headers.Authorization, "Bearer current-user");
  assert.equal(calls.uploads[0].uploadOptions.upsert, false);
  assert.equal(calls.uploads[0].uploadOptions.cacheControl, "31536000");
  assert.equal(calls.uploads[0].uploadOptions.contentType, "image/jpeg");
  assert.equal(calls.rpc[0].args.upload_storage_path, body.path);
  assert.equal(calls.rpc[1].args.upload_association_token, ASSOCIATION_TOKEN);
  assertTelemetry(calls, "info", "upload_ok", 200);
});

test("Edge exact duplicate succeeds, Storage failure is sanitized, and unexpected failure logs once", async (t) => {
  await t.test("exact duplicate", async () => {
    const { calls, handler } = await createEndpointHarness({ uploadError: { statusCode: 409, message: "already exists" } });
    const response = await handler(uploadRequest());
    assert.equal(response.status, 200);
    assert.equal((await json(response)).ok, true);
    assertTelemetry(calls, "info", "upload_ok", 200);
  });
  await t.test("Storage failure", async () => {
    const { calls, handler } = await createEndpointHarness({ uploadError: { statusCode: 500, message: "provider secret" } });
    const response = await handler(uploadRequest());
    assert.equal(response.status, 502);
    assert.deepEqual(await json(response), { ok: false, code: "upload_failed", message: "The image could not be stored." });
    assertTelemetry(calls, "error", "upload_failed", 502);
    assert.ok(calls.rpc.some((call) => call.name === "cancel_course_cover_upload"));
    assert.doesNotMatch(calls.logs[0].value, /provider|secret/);
  });
  await t.test("upload intent completion failure is fail-closed", async () => {
    const { calls, handler } = await createEndpointHarness({ completeResult: false });
    const response = await handler(uploadRequest());
    assert.equal(response.status, 503);
    assert.equal((await json(response)).code, "upload_confirmation_pending");
    assert.ok(calls.order.indexOf("upload") < calls.order.indexOf("complete_course_cover_upload"));
    assertTelemetry(calls, "error", "upload_confirmation_pending", 503);
  });
  await t.test("public URL with a query is rejected", async () => {
    const { calls, handler } = await createEndpointHarness({
      publicUrl: `${PROJECT_URL}/storage/v1/object/public/course-covers/${MANAGED_PATH}?token=unexpected`,
    });
    const response = await handler(uploadRequest());
    assert.equal(response.status, 500);
    assert.equal((await json(response)).code, "internal_error");
    assertTelemetry(calls, "error", "internal_error", 500);
  });
  await t.test("unexpected failure", async () => {
    const { calls, handler } = await createEndpointHarness({ serviceThrows: true });
    const response = await handler(uploadRequest());
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
    assert.deepEqual(await json(response), { ok: false, code: "internal_error", message: "Upload is unavailable." });
    assertTelemetry(calls, "error", "internal_error", 500);
    const telemetry = calls.logs[0].value;
    assert.doesNotMatch(telemetry, /Bearer|secret|sha256|deadbeef|project\.supabase|cover\.png|user-id/);
  });
});

test("migration layout and 0011/0012 contracts remain fail-closed", () => {
  // Todo se deriva del disco: agregar una migración no obliga a tocar este
  // archivo. Ver el comentario largo al tope sobre por qué ya no hay hashes.
  const entries = fs.readdirSync(MIGRATIONS_PATH, { withFileTypes: true });
  assert.ok(entries.every((entry) => entry.isFile()), "migration directory must contain only files");
  const actualFiles = entries.map((entry) => entry.name).sort();

  // La contigüidad es la garantía que de verdad importa: atrapa un hueco por
  // borrado y atrapa que dos ramas hayan creado el mismo número.
  const versions = actualFiles.map((file) => file.slice(0, 4));
  assert.equal(new Set(versions).size, versions.length, "migration versions must be unique");
  assert.deepEqual(
    versions,
    Array.from({ length: actualFiles.length }, (_, index) => String(index + 1).padStart(4, "0")),
    "migration versions must run contiguously from 0001 with no gaps",
  );

  if (fs.existsSync(OLD_MIGRATIONS_PATH)) {
    const oldSqlFiles = fs.readdirSync(OLD_MIGRATIONS_PATH).filter((file) => file.endsWith(".sql"));
    assert.deepEqual(oldSqlFiles, [], "old migration directory must not retain SQL files");
  }

  assert.equal(MIGRATION_PATH, "supabase/migrations/0011_portadas_cursos_storage.sql");
  assert.equal(path.resolve(CLEANUP_MIGRATION_PATH), path.resolve(MIGRATIONS_PATH, "0012_secure_course_cover_cleanup.sql"));

  const executableSql = MIGRATION_SOURCE.replace(/^--.*$/gm, "").trim();
  assert.equal((executableSql.match(/^begin\s*;/gim) || []).length, 1);
  assert.equal((executableSql.match(/^commit\s*;/gim) || []).length, 1);
  assert.match(executableSql, /to_regprocedure\('public\.es_admin\(\)'\)\s+is\s+null/i);
  assert.match(executableSql, /on\s+conflict\s*\(id\)\s+do\s+nothing/i);
  assert.match(executableSql, /from\s+pg_policies[\s\S]*cmd\s+in\s*\('ALL', 'INSERT', 'UPDATE', 'DELETE'\)/i);
  assert.match(executableSql, /roles\s*&&\s*array\['public', 'anon', 'authenticated'\]::name\[\]/i);
  assert.match(executableSql, /file_size_limit\s+is\s+distinct\s+from\s+5242880/i);
  assert.match(executableSql, /cardinality\(bucket\.allowed_mime_types\)[\s\S]*@>[\s\S]*<@/i);
  assert.doesNotMatch(executableSql, /on\s+conflict[\s\S]*do\s+update/i);
  assert.doesNotMatch(executableSql, /\bdrop\s+policy\b/i);
  assert.doesNotMatch(executableSql, /\bcreate\s+policy\b/i);

  const cleanupSql = CLEANUP_MIGRATION_SOURCE.replace(/^--.*$/gm, "").trim();
  assert.match(cleanupSql, /add\s+column\s+imagen_storage_path\s+text/i);
  assert.match(cleanupSql, /sha256\/\[0-9a-f\]\{64\}/i);
  assert.match(cleanupSql, /yqkvgfqplmbbcebrivpt\\\.supabase\\\.co/i);
  assert.match(cleanupSql, /create\s+table\s+public\.course_cover_cleanup_queue/i);
  assert.match(cleanupSql, /create\s+table\s+public\.course_cover_objects/i);
  assert.match(cleanupSql, /create\s+table\s+public\.course_cover_upload_intents/i);
  assert.match(cleanupSql, /force\s+row\s+level\s+security/i);
  assert.match(cleanupSql, /revoke\s+all[\s\S]*from\s+public,\s*anon,\s*authenticated/i);
  assert.match(cleanupSql, /create\s+trigger\s+cursos_enqueue_cover_cleanup[\s\S]*after\s+update[\s\S]*or\s+delete/i);
  assert.match(cleanupSql, /pg_advisory_xact_lock/i);
  assert.match(cleanupSql, /claim_token\s+uuid/i);
  assert.match(cleanupSql, /claim_generation\s+bigint/i);
  assert.match(cleanupSql, /state\s*=\s*'deleted'/i);
  assert.match(cleanupSql, /from\s+storage\.objects[\s\S]*bucket_id\s*=\s*'course-covers'/i);
  assert.match(cleanupSql, /derived_path\s*:=\s*substring/i);
  assert.match(cleanupSql, /begin_course_cover_upload/i);
  assert.match(cleanupSql, /complete_course_cover_upload/i);
  assert.match(cleanupSql, /claim_course_cover_cleanup/i);
  assert.match(cleanupSql, /retry_course_cover_cleanup/i);
  assert.match(cleanupSql, /complete_course_cover_cleanup/i);
  assert.doesNotMatch(cleanupSql, /delete\s+from\s+storage\.objects/i);
  assert.doesNotMatch(cleanupSql, /grant[\s\S]*to\s+(?:anon|authenticated)/i);
});

test("0013 raises only the course-cover bucket limit to decimal 10 MB with guarded postconditions", () => {
  assert.equal(fs.existsSync(BUCKET_LIMIT_MIGRATION_PATH), true);
  assert.equal(fs.existsSync(BUCKET_LIMIT_TEST_PATH), true);
  const sql = fs.readFileSync(BUCKET_LIMIT_MIGRATION_PATH, "utf8").replace(/^--.*$/gm, "");
  const harness = fs.readFileSync(BUCKET_LIMIT_TEST_PATH, "utf8");
  assert.match(sql, /begin\s*;/i);
  assert.match(sql, /update\s+storage\.buckets/i);
  assert.match(sql, /file_size_limit\s*=\s*10000000/i);
  assert.match(sql, /where\s+id\s*=\s*'course-covers'/i);
  assert.match(sql, /file_size_limit\s+is\s+distinct\s+from\s+10000000/i);
  assert.match(sql, /commit\s*;/i);
  assert.doesNotMatch(sql, /insert\s+into\s+storage\.buckets/i);
  assert.match(harness, /taudux_cover_0013_test/i);
  assert.match(harness, /10000000/);
});

test("static contracts preserve scope, dynamic server import, CORS, and tested form wiring", () => {
  const user = FUNCTION_SOURCE.indexOf("caller.auth.getUser()");
  const admin = FUNCTION_SOURCE.indexOf('caller.rpc("es_admin")');
  const serviceRole = FUNCTION_SOURCE.indexOf('getEnv("SUPABASE_SERVICE_ROLE_KEY")');
  const dynamicImport = FUNCTION_SOURCE.indexOf('import("@supabase/supabase-js")');
  assert.ok(user >= 0 && user < admin && admin < serviceRole && serviceRole < dynamicImport);
  assert.match(FUNCTION_SOURCE, /globalThis\.Deno.*Deno\.serve/s);
  assert.doesNotMatch(FUNCTION_SOURCE, /ERROR_RATE_THRESHOLDS_PERCENT|errorRateThresholdsPercent/);
  assert.match(FUNCTION_SOURCE, /https:\/\/taudux\.com/);
  // taudux.github.io salió del allowlist: nunca sirvió el sitio (devuelve 404,
  // el deploy es Vercel) y el repo dejó de llamarse así. Se blinda su ausencia
  // para que no vuelva a colarse un origen muerto.
  assert.doesNotMatch(FUNCTION_SOURCE, /taudux\.github\.io/);
  assert.match(FUNCTION_SOURCE, /localhost.*127\.0\.0\.1/s);
  assert.doesNotMatch(FUNCTION_SOURCE, /Access-Control-Allow-Origin[^\n]+\*/);
  assert.doesNotMatch(MIGRATION_SOURCE, /create\s+policy[\s\S]*storage\.objects/i);
  assert.doesNotMatch(MIGRATION_SOURCE, /on\s+storage\.objects\s+for\s+(insert|update|delete)/i);
  assert.doesNotMatch(BROWSER_SOURCE, /\.storage\b|SUPABASE_SERVICE_ROLE_KEY|Deno\.env/);
  assert.doesNotMatch(SERVICE_SOURCE + FUNCTION_SOURCE, /\.(remove|list|update)\s*\(|localStorage|sessionStorage/);
  assert.match(FORM_SOURCE, /crearFlujoMutacionCurso/);
  assert.match(FORM_SOURCE, /controles: form\.elements/);
  assert.doesNotMatch(FORM_SOURCE, /inputImagen|seleccionarUrlExterna|URL externa/);
  assert.match(FORM_HTML_SOURCE, /id="cursoPortada"\s+type="file"/);
  assert.match(FORM_HTML_SOURCE, />Quitar imagen actual<\/button>/);
  assert.match(FORM_SOURCE, /window\.confirm\(/);
  assert.match(FORM_SOURCE, /portadaEsperada:/);
  assert.doesNotMatch(FORM_HTML_SOURCE, /cursoImagen|URL externa de imagen|una URL externa|se descarta la otra/);
  assert.match(SERVICE_SOURCE, /let\s+operacionCreacion\s*=\s*null/);
  assert.doesNotMatch(FORM_SOURCE + SERVICE_SOURCE, /localStorage|sessionStorage|indexedDB/);
  assert.match(fs.readFileSync("supabase/functions/upload-course-cover/deno.json", "utf8"), /2\.110\.8/);
});

test("cover edit state has explicit retain, replacement, and confirmed-removal transitions", () => {
  const current = crearEstadoPortadaEdicion({ imagen_url: MANAGED_URL, imagen_storage_path: MANAGED_PATH });
  assert.equal(current.tieneActual(), true);
  assert.equal(current.seleccionarArchivo(null), "retain");
  const file = selectedFile();
  assert.equal(current.seleccionarArchivo(file), "replacement");
  assert.equal(current.obtenerArchivo(), file);
  assert.deepEqual(current.obtenerActual(), { url: MANAGED_URL, path: MANAGED_PATH });
  current.confirmarRetiro();
  assert.equal(current.tieneActual(), false);
  assert.equal(current.obtenerArchivo(), null);
  assert.deepEqual(current.obtenerActual(), { url: null, path: null });
  assert.equal(current.seleccionarArchivo(file), "replacement");
});

test("course form exposes the accessible crop workflow and loads it before the controller", () => {
  assert.match(FORM_HTML_SOURCE, /class="courses__cropper"/);
  assert.match(FORM_HTML_SOURCE, /<canvas[^>]+id="cursoPortadaLienzo"[^>]+aria-describedby="cursoPortadaInstrucciones"/s);
  assert.match(FORM_HTML_SOURCE, /id="cursoPortadaZoom"[^>]+type="range"[^>]+aria-label="Zoom de la portada"/s);
  assert.match(FORM_HTML_SOURCE, /id="cursoPortadaRestablecer"[^>]*>Restablecer recorte</);
  assert.match(FORM_HTML_SOURCE, /id="cursoPortadaError"[^>]+role="alert"/s);
  const cropperScript = FORM_HTML_SOURCE.indexOf("course-cover-cropper.js");
  const controllerScript = FORM_HTML_SOURCE.indexOf("gestionar-curso.js");
  assert.ok(cropperScript > 0 && cropperScript < controllerScript);
});

test("course submit generates the cover before upload and preserves retain/removal bypasses", () => {
  const exportCall = CONTROLLER_SOURCE.indexOf("await portada.generarArchivo()");
  const mutationCall = CONTROLLER_SOURCE.indexOf("const resultado = await flujoMutacionCurso.ejecutar");
  assert.ok(exportCall > 0 && exportCall < mutationCall);
  assert.match(FORM_COVER_SOURCE, /cropper\.exportFile\(\)/);
  assert.match(FORM_SOURCE, /estadoEdicion\.tieneActual\(\)/);
  assert.match(FORM_SOURCE, /estadoEdicion\.confirmarRetiro\(\)/);
  assert.match(FORM_COVER_SOURCE, /error\.focus\(\)/);
});

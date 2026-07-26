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
const MIGRATIONS_PATH = "supabase/migrations";
const OLD_MIGRATIONS_PATH = ".kiro/supabase/migrations";
const FORM_PATH = "src/app/features/courses/gestionar-curso.js";
const FORM_HTML_PATH = "src/app/features/courses/gestionar-curso.html";
const EXPECTED_MIGRATION_HASHES = Object.freeze({
  "0001_crear_perfiles.sql": "26ceb164a9867a458f0b146dba7a875f3326ac273c9e6ca478f77a70db7033b7",
  "0002_perfil_telefono.sql": "8f42344006b42ab8babc7c6fb854dcf353a25785296c8b390978b0b78522992c",
  "0003_perfil_solo_confirmados.sql": "a7fdb9b4efdef11a4919654e4c4678afd696ed705d8ddae70fbb66e28ea8d9a2",
  "0004_crear_cursos.sql": "57c5a4bf73d6c64bbe7ca391c238de058d603885ff36a7e79190e0739fd74a30",
  "0005_cursos_lectura_publica.sql": "f8ca0ec8f3c1eb023b99791a419c79c8226e17ac78f56c633196315971074bb3",
  "0006_cursos_detalles.sql": "12981517187212fb28a7068b59820c03d96f398678e4cdca70c74caa94306dd1",
  "0007_cursos_recurrentes.sql": "5240c6f7c81d1d475168d513c0002bab8d780408668a911aef0bf91b11929855",
  "0008_cursos_proximamente.sql": "3e384a48eb1ffd49fb14d2884853c0b71eea8f68da1808564e9a0d0b8bb15931",
  "0009_cursos_categoria_valida.sql": "be9f6bb2eb72dfdd8302ed9d923793468bd52314cf81b16a49f07a8351e21637",
  "0010_normalizar_categorias_cursos.sql": "dd9dee6da65b5fa1d264a5c2ab878109404be973b2eb46d40e6ae4f101a0b099",
  "0011_portadas_cursos_storage.sql": "d95ee0e59eb896c76f43b9a8f276b19748341566830816b7eb3a655981d22bea",
});
const SERVICE_SOURCE = fs.readFileSync(SERVICE_PATH, "utf8");
const FUNCTION_SOURCE = fs.readFileSync(FUNCTION_PATH, "utf8");
const MIGRATION_SOURCE = fs.readFileSync(MIGRATION_PATH, "utf8");
const FORM_SOURCE = fs.readFileSync(FORM_PATH, "utf8");
const FORM_HTML_SOURCE = fs.readFileSync(FORM_HTML_PATH, "utf8");
const BROWSER_SOURCE = fs.readdirSync("src", { recursive: true })
  .filter((file) => /\.(?:html|js)$/.test(file))
  .map((file) => fs.readFileSync(path.join("src", file), "utf8")).join("\n");
const validation = import(pathToFileURL(path.resolve(VALIDATION_PATH)).href);
const endpoint = import(pathToFileURL(path.resolve(FUNCTION_PATH)).href);
const { crearClientePortadas, crearFlujoMutacionCurso } = require(path.resolve(SERVICE_PATH));
const { crearDatosEnvioCurso } = require(path.resolve(FORM_PATH));

const ORIGIN = "https://taudux.com";
const PROJECT_URL = "https://project.supabase.co";
const PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
));
const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0,
  0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 1, 0xff, 0xd9,
]);
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

function uploadRequest(options = {}) {
  const origin = Object.hasOwn(options, "origin") ? options.origin : ORIGIN;
  const token = Object.hasOwn(options, "token") ? options.token : "Bearer current-user";
  const file = Object.hasOwn(options, "file") ? options.file : selectedFile();
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
  const calls = { order: [], uploads: [], publicPaths: [], decoded: 0, closed: 0, logs: [], fetches: [] };
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
      return { storage: { from(name) {
        calls.order.push("storage");
        assert.equal(name, "course-covers");
        return bucket;
      } } };
    },
    async decodeImage(bytes, mime) {
      calls.order.push("decode");
      calls.decoded++;
      if (options.decoderError) throw options.decoderError;
      const bitmap = {
        width: options.bitmapWidth ?? 1,
        height: options.bitmapHeight ?? 1,
        close() { calls.closed++; },
      };
      assert.equal(mime, "image/png");
      assert.ok(bytes.byteLength > 0);
      return bitmap;
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
  assert.deepEqual(Object.keys(event).sort(), ["code", "durationMs", "errorRateThresholdsPercent", "event", "status"].sort());
  assert.equal(event.event, "upload_course_cover");
  assert.equal(event.code, code);
  assert.equal(event.status, status);
  assert.equal(event.durationMs, 7);
  assert.deepEqual(event.errorRateThresholdsPercent, [1, 2, 5]);
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
  const observed = service.subir(selectedFile()).then(
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
      return { data: { ok: true, url: "https://project.supabase.co/cover.png" }, error: null };
    } } },
    setTimer: () => 37,
    clearTimer: (id) => { cleared = id; },
    AbortControllerImpl: AbortController,
  });
  assert.equal(await service.subir(selectedFile()), "https://project.supabase.co/cover.png");
  assert.ok(options.body instanceof FormData);
  assert.equal(options.body.getAll("file").length, 1);
  assert.equal(options.signal.aborted, false);
  assert.equal(cleared, 37);
});

test("browser maps function outcomes without exposing remote details", async () => {
  const responses = [
    [{ data: null, error: { context: { json: async () => ({ code: "auth_required", message: "secret" }) } } }, /sesión expiró/],
    [{ data: { ok: false, code: "forbidden" }, error: null }, /permisos/],
    [{ data: { ok: false, code: "invalid_image" }, error: null }, /imagen JPG/],
    [{ data: { ok: false, code: "decoder_unavailable" }, error: null }, /temporalmente/],
    [{ data: { ok: false, code: "upload_failed" }, error: null }, /No se pudo subir/],
  ];
  for (const [response, expected] of responses) {
    let cleared = false;
    const service = crearClientePortadas({
      client: { functions: { invoke: async () => response } },
      setTimer: () => 1,
      clearTimer: () => { cleared = true; },
      AbortControllerImpl: AbortController,
    });
    await assert.rejects(service.subir(selectedFile()), expected);
    assert.equal(cleared, true);
  }
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
    firma: "edit-without-selected-file",
    controles: [],
  });

  assert.equal(resultado.ok, true);
  assert.equal(lecturasUrlExterna, 0);
  assert.equal(actualizaciones.length, 1);
  assert.equal(actualizaciones[0].id, "course-1");
  assert.equal(actualizaciones[0].campos.imagen_url, portadaExistente);
  assert.equal(Object.hasOwn(actualizaciones[0].campos, "cursoImagen"), false);
});

test("shared form workflow uploads local covers and preserves an existing cover without a file", async () => {
  const controls = [{ disabled: false }, { disabled: true }, { disabled: false }];
  const calls = [];
  const flow = crearFlujoMutacionCurso({
    subirPortada: async () => {
      assert.ok(controls.every((control) => control.disabled));
      calls.push("upload");
      return "https://project.supabase.co/local.png";
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
  assert.equal(calls[1].datos.imagen_url, "https://project.supabase.co/local.png");
  assert.equal(calls[1].id, "operation-1");
  assert.deepEqual(controls.map((control) => control.disabled), [false, true, false]);
  calls.length = 0;
  await flow.ejecutar({
    cursoId: "course-1",
    datos: { titulo: "Editado", imagen_url: "https://legacy.example/cover.png" },
    archivoPortada: selectedFile(),
    firma: "edit-local",
    controles: controls,
  });
  assert.equal(calls[0], "upload");
  assert.equal(calls[1].action, "update");
  assert.equal(calls[1].datos.imagen_url, "https://project.supabase.co/local.png");
  calls.length = 0;
  await flow.ejecutar({
    cursoId: "course-1",
    datos: { titulo: "Editado", imagen_url: "https://legacy.example/cover.png" },
    archivoPortada: null,
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
  const uploadFailure = crearFlujoMutacionCurso({
    subirPortada: async () => { throw new Error("No se pudo subir la portada."); },
    crearCurso: async () => { databaseCalls++; return { ok: true }; },
    actualizarCurso: async () => { databaseCalls++; return { ok: true }; },
    generarOperacionId: () => "operation-1",
  });
  const failedUpload = await uploadFailure.ejecutar({
    cursoId: null, datos: { titulo: "Curso" }, archivoPortada: selectedFile(), firma: "a", controles: controls,
  });
  assert.equal(failedUpload.ok, false);
  assert.equal(failedUpload.etapa, "upload");
  assert.equal(databaseCalls, 0);
  assert.deepEqual(controls.map((control) => control.disabled), [false, true]);

  const databaseFailure = crearFlujoMutacionCurso({
    subirPortada: async () => "https://project.supabase.co/cover.png",
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
  assert.equal(calls.decoded, 0);
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

test("Edge decoder is mandatory, rejects failures/mismatches, and always closes bitmaps", async (t) => {
  await t.test("non-decodable structural image", async () => {
    const { calls, handler } = await createEndpointHarness({ decoderError: new Error("decode failed provider payload") });
    const response = await handler(uploadRequest());
    assert.equal(response.status, 400);
    assert.equal((await json(response)).code, "invalid_image");
    assert.equal(calls.decoded, 1);
    assert.ok(!calls.order.includes("service"));
  });
  await t.test("decoder unavailable", async () => {
    const error = new Error("unavailable"); error.code = "decoder_unavailable";
    const { calls, handler } = await createEndpointHarness({ decoderError: error });
    const response = await handler(uploadRequest());
    assert.equal(response.status, 503);
    assert.equal((await json(response)).code, "decoder_unavailable");
    assertTelemetry(calls, "error", "decoder_unavailable", 503);
  });
  await t.test("dimension mismatch", async () => {
    const { calls, handler } = await createEndpointHarness({ bitmapWidth: 2 });
    const response = await handler(uploadRequest());
    assert.equal(response.status, 400);
    assert.equal((await json(response)).code, "invalid_image");
    assert.equal(calls.closed, 1);
    assert.ok(!calls.order.includes("service"));
  });
});

test("Edge success uses caller context before service role, decodes, uploads, and logs denominator", async () => {
  const { calls, handler } = await createEndpointHarness({ defaultCaller: true });
  const response = await handler(uploadRequest());
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.ok, true);
  assert.match(body.url, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/course-covers\/sha256\/[0-9a-f]{64}\.png$/);
  assert.deepEqual(calls.order, ["getUser", "es_admin", "decode", "service", "storage", "upload"]);
  assert.equal(calls.fetches.length, 2);
  assert.equal(calls.fetches[0].init.headers.Authorization, "Bearer current-user");
  assert.equal(calls.fetches[1].init.headers.Authorization, "Bearer current-user");
  assert.equal(calls.closed, 1);
  assert.equal(calls.uploads[0].uploadOptions.upsert, false);
  assert.equal(calls.uploads[0].uploadOptions.cacheControl, "31536000");
  assert.equal(calls.uploads[0].uploadOptions.contentType, "image/png");
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
    assert.doesNotMatch(calls.logs[0].value, /provider|secret/);
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

test("migration layout and 0011 preflight remain fail-closed", () => {
  const expectedFiles = Object.keys(EXPECTED_MIGRATION_HASHES);
  const entries = fs.readdirSync(MIGRATIONS_PATH, { withFileTypes: true });
  assert.ok(entries.every((entry) => entry.isFile()), "migration directory must contain only files");
  const actualFiles = entries.map((entry) => entry.name).sort();
  assert.deepEqual(actualFiles, expectedFiles);

  const versions = actualFiles.map((file) => file.slice(0, 4));
  assert.equal(new Set(versions).size, versions.length, "migration versions must be unique");
  assert.deepEqual(versions, Array.from({ length: 11 }, (_, index) => String(index + 1).padStart(4, "0")));

  if (fs.existsSync(OLD_MIGRATIONS_PATH)) {
    const oldSqlFiles = fs.readdirSync(OLD_MIGRATIONS_PATH).filter((file) => file.endsWith(".sql"));
    assert.deepEqual(oldSqlFiles, [], "old migration directory must not retain SQL files");
  }

  for (const [file, expectedHash] of Object.entries(EXPECTED_MIGRATION_HASHES)) {
    const bytes = fs.readFileSync(path.join(MIGRATIONS_PATH, file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash, file);
  }

  assert.equal(MIGRATION_PATH, "supabase/migrations/0011_portadas_cursos_storage.sql");
  assert.equal(path.resolve(MIGRATION_PATH), path.resolve(MIGRATIONS_PATH, expectedFiles.at(-1)));

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
});

test("static contracts preserve scope, dynamic server import, CORS, and tested form wiring", () => {
  const user = FUNCTION_SOURCE.indexOf("caller.auth.getUser()");
  const admin = FUNCTION_SOURCE.indexOf('caller.rpc("es_admin")');
  const serviceRole = FUNCTION_SOURCE.indexOf('getEnv("SUPABASE_SERVICE_ROLE_KEY")');
  const dynamicImport = FUNCTION_SOURCE.indexOf('import("@supabase/supabase-js")');
  assert.ok(user >= 0 && user < admin && admin < serviceRole && serviceRole < dynamicImport);
  assert.match(FUNCTION_SOURCE, /globalThis\.Deno.*Deno\.serve/s);
  assert.match(FUNCTION_SOURCE, /ERROR_RATE_THRESHOLDS_PERCENT = Object\.freeze\(\[1, 2, 5\]\)/);
  assert.match(FUNCTION_SOURCE, /https:\/\/taudux\.com/);
  assert.match(FUNCTION_SOURCE, /https:\/\/taudux\.github\.io/);
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
  assert.doesNotMatch(FORM_HTML_SOURCE, /cursoImagen|URL externa de imagen|una URL externa|se descarta la otra/);
  assert.doesNotMatch(FORM_SOURCE, /operacionCreacion|localStorage|sessionStorage/);
  assert.match(fs.readFileSync("supabase/functions/upload-course-cover/deno.json", "utf8"), /2\.110\.8/);
});

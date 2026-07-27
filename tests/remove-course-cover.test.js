const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const FUNCTION_PATH = path.resolve("supabase/functions/remove-course-cover/index.ts");
const endpoint = import(pathToFileURL(FUNCTION_PATH).href);
const ORIGIN = "https://taudux.com";
const PROJECT_URL = "https://yqkvgfqplmbbcebrivpt.supabase.co";
const COURSE_ID = "123e4567-e89b-42d3-a456-426614174000";
const MANAGED_PATH = `sha256/${"b".repeat(64)}.webp`;
const MANAGED_URL = `${PROJECT_URL}/storage/v1/object/public/course-covers/${MANAGED_PATH}`;
const CLAIM_TOKEN = "123e4567-e89b-42d3-a456-426614174111";

function removalRequest(options = {}) {
  const { body, method = "POST" } = options;
  const origin = Object.hasOwn(options, "origin") ? options.origin : ORIGIN;
  const token = Object.hasOwn(options, "token") ? options.token : "Bearer admin";
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  if (token !== undefined) headers.authorization = token;
  if (method === "OPTIONS") return new Request("https://edge.test/remove", { method, headers });
  headers["content-type"] = "application/json";
  return new Request("https://edge.test/remove", {
    method,
    headers,
    body: JSON.stringify(body ?? {
      courseId: COURSE_ID,
      expected: { url: MANAGED_URL, path: MANAGED_PATH },
    }),
  });
}

async function payload(response) {
  return JSON.parse(await response.text());
}

async function createHarness(options = {}) {
  const { createRemoveCourseCoverHandler } = await endpoint;
  const calls = { order: [], rpc: [], removed: [], logs: [] };
  const current = Object.hasOwn(options, "current")
    ? options.current
    : { id: COURSE_ID, imagen_url: MANAGED_URL, imagen_storage_path: MANAGED_PATH };
  const jobs = [...(options.jobs ?? [{
    storage_path: MANAGED_PATH,
    attempt_count: 1,
    claim_token: CLAIM_TOKEN,
    claim_generation: 1,
  }])];
  const query = {
    select() { calls.order.push("select_course"); return this; },
    eq() { return this; },
    async maybeSingle() {
      return options.courseError ? { data: null, error: true } : { data: current, error: null };
    },
  };
  const serviceClient = {
    from(name) {
      assert.equal(name, "cursos");
      return query;
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      calls.order.push(name);
      if (name === "remove_course_cover") {
        return { data: [{
          result: options.rpcResult || "removed",
          cleanup_storage_path: Object.hasOwn(options, "cleanupPath") ? options.cleanupPath : MANAGED_PATH,
        }], error: options.dissociationError || null };
      }
      if (name === "claim_course_cover_cleanup") {
        return { data: jobs.length ? [jobs.shift()] : [], error: options.claimError || null };
      }
      if (name === "complete_course_cover_cleanup") {
        return { data: options.completeResult ?? true, error: options.completeError || null };
      }
      if (name === "retry_course_cover_cleanup") return { data: options.retryResult ?? true, error: null };
      if (name === "course_cover_cleanup_status") {
        return { data: [{ status: options.cleanupStatus || "queued" }], error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    storage: {
      from(name) {
        assert.equal(name, "course-covers");
        return {
          async remove(paths) {
            calls.order.push("storage_remove");
            calls.removed.push(paths);
            if (options.removeThrows) throw new Error("provider secret");
            return { data: [], error: options.removeError || null };
          },
        };
      },
    },
  };
  const dependencies = {
    getEnv(name) {
      return {
        SUPABASE_URL: PROJECT_URL,
        SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-secret",
      }[name];
    },
    createCallerClient() {
      calls.order.push("caller");
      return {
        auth: { async getUser() {
          calls.order.push("getUser");
          return options.invalidUser
            ? { data: { user: null }, error: true }
            : { data: { user: { id: "admin-id" } }, error: null };
        } },
        async rpc(name) {
          assert.equal(name, "es_admin");
          calls.order.push("es_admin");
          return { data: options.admin === false ? false : true, error: null };
        },
      };
    },
    async createServiceClient() {
      calls.order.push("service");
      return serviceClient;
    },
    logger: {
      info(value) { calls.logs.push({ level: "info", value }); },
      error(value) { calls.logs.push({ level: "error", value }); },
    },
    now: (() => { let value = 0; return () => (value += 5); })(),
  };
  return { calls, handler: createRemoveCourseCoverHandler(dependencies) };
}

test("remove Edge handler enforces origin, JWT, and admin before service-role access", async () => {
  for (const [request, options, status, code] of [
    [removalRequest({ origin: "https://evil.example" }), {}, 403, "invalid_origin"],
    [removalRequest({ token: undefined }), {}, 401, "auth_required"],
    [removalRequest(), { invalidUser: true }, 401, "auth_required"],
    [removalRequest(), { admin: false }, 403, "forbidden"],
  ]) {
    const { calls, handler } = await createHarness(options);
    const response = await handler(request);
    assert.equal(response.status, status);
    assert.equal((await payload(response)).code, code);
    assert.ok(!calls.order.includes("service"));
  }
});

test("managed removal dissociates first and deletes only the server-claimed canonical path", async () => {
  const { calls, handler } = await createHarness();
  const response = await handler(removalRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await payload(response), {
    ok: true,
    removed: true,
    cleanup: {
      status: "deleted",
      pending: false,
      counters: {
        requestedClaimed: 1,
        requestedDeleted: 1,
        requestedQueued: 0,
        backlogClaimed: 0,
        backlogDeleted: 0,
        backlogQueued: 0,
        failures: 0,
      },
    },
  });
  assert.deepEqual(calls.removed, [[MANAGED_PATH]]);
  const dissociate = calls.order.indexOf("remove_course_cover");
  const claim = calls.order.indexOf("claim_course_cover_cleanup");
  const storage = calls.order.indexOf("storage_remove");
  assert.ok(dissociate >= 0 && dissociate < claim && claim < storage);
  assert.equal(calls.rpc.find((call) => call.name === "remove_course_cover").args.expected_storage_path, MANAGED_PATH);
  assert.equal(calls.rpc.find((call) => call.name === "claim_course_cover_cleanup").args.preferred_storage_path, MANAGED_PATH);
  const complete = calls.rpc.find((call) => call.name === "complete_course_cover_cleanup");
  assert.equal(complete.args.cleanup_claim_token, CLAIM_TOKEN);
  assert.equal(complete.args.cleanup_claim_generation, 1);
});

test("external legacy URL is dissociated without any Storage deletion", async () => {
  const external = "https://legacy.example/cover.jpg?private=credential";
  const { calls, handler } = await createHarness({
    current: { id: COURSE_ID, imagen_url: external, imagen_storage_path: null },
    cleanupPath: null,
    jobs: [],
  });
  const response = await handler(removalRequest({
    body: { courseId: COURSE_ID, expected: { url: external, path: null } },
  }));
  assert.equal(response.status, 200);
  assert.equal((await payload(response)).removed, true);
  assert.deepEqual(calls.removed, []);
  assert.ok(calls.rpc.some((call) => call.name === "remove_course_cover"));
});

test("stale expected pair returns cover_conflict before dissociation or Storage access", async () => {
  const { calls, handler } = await createHarness();
  const response = await handler(removalRequest({
    body: { courseId: COURSE_ID, expected: { url: "https://legacy.example/stale.jpg", path: null } },
  }));
  assert.equal(response.status, 409);
  assert.equal((await payload(response)).code, "cover_conflict");
  assert.equal(calls.rpc.length, 0);
  assert.deepEqual(calls.removed, []);
});

test("Storage failure keeps dissociation successful and records a sanitized durable retry", async () => {
  const { calls, handler } = await createHarness({ removeError: { statusCode: 500, message: "provider secret" } });
  const response = await handler(removalRequest());
  assert.equal(response.status, 202);
  const body = await payload(response);
  assert.equal(body.cleanup.status, "queued");
  assert.equal(body.cleanup.pending, true);
  assert.equal(body.cleanup.counters.requestedQueued, 1);
  assert.equal(body.cleanup.counters.failures, 1);
  const retry = calls.rpc.find((call) => call.name === "retry_course_cover_cleanup");
  assert.equal(retry.args.sanitized_error, "storage_remove_failed");
  assert.equal(retry.args.cleanup_claim_token, CLAIM_TOKEN);
  assert.equal(retry.args.cleanup_claim_generation, 1);
  assert.doesNotMatch(calls.logs[0].value, /provider|secret|course-covers|sha256|admin-id/);
});

test("an explicit missing-object result is idempotent and completes the queue job", async () => {
  const { calls, handler } = await createHarness({ removeError: { statusCode: 404, code: "not_found" } });
  const response = await handler(removalRequest());
  assert.equal(response.status, 200);
  assert.equal((await payload(response)).cleanup.status, "deleted");
  assert.ok(calls.rpc.some((call) => call.name === "complete_course_cover_cleanup"));
  assert.ok(!calls.rpc.some((call) => call.name === "retry_course_cover_cleanup"));
});

test("completion persistence failure stays tombstoned/queued and is never reported as remove_ok", async () => {
  const { calls, handler } = await createHarness({
    completeResult: false,
    cleanupStatus: "queued",
  });
  const response = await handler(removalRequest());
  assert.equal(response.status, 202);
  const body = await payload(response);
  assert.equal(body.cleanup.status, "queued");
  assert.equal(body.cleanup.pending, true);
  const retry = calls.rpc.find((call) => call.name === "retry_course_cover_cleanup");
  assert.equal(retry.args.sanitized_error, "completion_persistence_unknown_after_delete");
  const event = JSON.parse(calls.logs[0].value);
  assert.equal(event.code, "remove_cleanup_pending");
  assert.equal(event.cleanupStatus, "queued");
  assert.equal(event.cleanupFailures, 1);
  assert.equal(Object.hasOwn(event, "errorRateThresholdsPercent"), false);
});

test("remove browser client sends only course ID and expected pair and maps conflicts", async () => {
  const { crearClientePortadas } = require(path.resolve("src/app/core/cursos/portadas-curso.service.js"));
  let invocation;
  const client = crearClientePortadas({
    client: { functions: { async invoke(name, options) {
      invocation = { name, options };
      return { data: { ok: false, code: "cover_conflict" }, error: null };
    } } },
    setTimer: () => 1,
    clearTimer() {},
    AbortControllerImpl: AbortController,
  });
  await assert.rejects(client.quitar(COURSE_ID, { url: MANAGED_URL, path: MANAGED_PATH }), (error) => {
    assert.equal(error.code, "cover_conflict");
    assert.match(error.message, /otra sesión/);
    return true;
  });
  assert.equal(invocation.name, "remove-course-cover");
  assert.deepEqual(invocation.options.body, {
    courseId: COURSE_ID,
    expected: { url: MANAGED_URL, path: MANAGED_PATH },
  });
  assert.deepEqual(Object.keys(invocation.options.body).sort(), ["courseId", "expected"]);
});

test("real form removal handler confirms, prevents duplicate clicks, clears selection, and focuses success", async () => {
  const formModule = require(path.resolve("src/app/features/courses/gestionar-curso.js"));
  const coverService = require(path.resolve("src/app/core/cursos/portadas-curso.service.js"));
  const editState = formModule.crearEstadoPortadaEdicion({
    imagen_url: MANAGED_URL,
    imagen_storage_path: MANAGED_PATH,
  });
  editState.seleccionarArchivo({ name: "replacement.png" });
  const controls = [{ disabled: false }, { disabled: true }];
  const busy = { value: null, setAttribute(_name, value) { this.value = value; } };
  const button = { textContent: "Quitar imagen actual" };
  const input = { value: "C:\\fakepath\\replacement.png" };
  const actions = { hidden: false };
  const status = { textContent: "", focused: 0, focus() { this.focused++; } };
  const local = { url: MANAGED_URL, path: MANAGED_PATH };
  const toasts = [];
  let confirmations = 0;
  let finishRemoval;
  const remove = new Promise((resolve) => { finishRemoval = resolve; });
  const handler = formModule.crearManejadorRetiroPortada({
    obtenerCursoId: () => COURSE_ID,
    obtenerEstadoEdicion: () => editState,
    confirmar() { confirmations++; return true; },
    quitar: () => remove,
    bloquearControles: coverService.bloquearControles,
    elementosFormulario: controls,
    controlesPortada: busy,
    boton: button,
    inputArchivo: input,
    accionesActuales: actions,
    estado: status,
    ocultarError() {},
    reportarFallo() {},
    mostrarToast(message, type) { toasts.push({ message, type }); },
    mostrarError() {},
    iniciarTiempo: () => 0,
    confirmarEstadoLocal() { local.url = null; local.path = null; },
  });

  const first = handler();
  await new Promise((resolve) => setImmediate(resolve));
  const duplicate = await handler();
  assert.deepEqual(duplicate, { ok: false, codigo: "removal_in_progress" });
  assert.equal(confirmations, 1);
  assert.ok(controls.every((control) => control.disabled));
  finishRemoval({ cleanup: { status: "queued", pending: true } });
  assert.equal((await first).ok, true);
  assert.deepEqual(editState.obtenerActual(), { url: null, path: null });
  assert.equal(editState.obtenerArchivo(), null);
  assert.deepEqual(local, { url: null, path: null });
  assert.equal(input.value, "");
  assert.equal(actions.hidden, true);
  assert.match(status.textContent, /limpieza de Storage quedó pendiente/);
  assert.equal(status.focused, 1);
  assert.deepEqual(toasts, [{ message: status.textContent, type: "warning" }]);
  assert.deepEqual(controls.map((control) => control.disabled), [false, true]);
  assert.equal(button.textContent, "Quitar imagen actual");
  assert.equal(busy.value, "false");
});

test("real form removal handler preserves state and selection on cancellation or failure", async () => {
  const formModule = require(path.resolve("src/app/features/courses/gestionar-curso.js"));
  const coverService = require(path.resolve("src/app/core/cursos/portadas-curso.service.js"));
  const editState = formModule.crearEstadoPortadaEdicion({
    imagen_url: MANAGED_URL,
    imagen_storage_path: MANAGED_PATH,
  });
  const selected = { name: "replacement.png" };
  editState.seleccionarArchivo(selected);
  const controls = [{ disabled: false }];
  const input = { value: "C:\\fakepath\\replacement.png" };
  const actions = { hidden: false };
  const status = { textContent: "", focus() { throw new Error("failure must not focus success"); } };
  const button = { textContent: "Quitar imagen actual" };
  const busy = { value: null, setAttribute(_name, value) { this.value = value; } };
  let allow = false;
  let removeCalls = 0;
  let errorFocus = 0;
  const handler = formModule.crearManejadorRetiroPortada({
    obtenerCursoId: () => COURSE_ID,
    obtenerEstadoEdicion: () => editState,
    confirmar: () => allow,
    async quitar() { removeCalls++; const error = new Error("No se pudo quitar."); error.code = "removal_failed"; throw error; },
    bloquearControles: coverService.bloquearControles,
    elementosFormulario: controls,
    controlesPortada: busy,
    boton: button,
    inputArchivo: input,
    accionesActuales: actions,
    estado: status,
    ocultarError() {},
    reportarFallo() {},
    mostrarToast() {},
    mostrarError() { errorFocus++; },
    iniciarTiempo: () => 0,
    confirmarEstadoLocal() { throw new Error("failure must not mutate local course"); },
  });

  assert.deepEqual(await handler(), { ok: false, codigo: "cancelled" });
  assert.equal(removeCalls, 0);
  allow = true;
  const failed = await handler();
  assert.equal(failed.ok, false);
  assert.equal(errorFocus, 1);
  assert.deepEqual(editState.obtenerActual(), { url: MANAGED_URL, path: MANAGED_PATH });
  assert.equal(editState.obtenerArchivo(), selected);
  assert.match(input.value, /replacement/);
  assert.equal(actions.hidden, false);
  assert.deepEqual(controls.map((control) => control.disabled), [false]);
  assert.equal(button.textContent, "Quitar imagen actual");
  assert.equal(busy.value, "false");
});

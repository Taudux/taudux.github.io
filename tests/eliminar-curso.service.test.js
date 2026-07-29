const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const CONSTANTS_SOURCE = fs.readFileSync("src/app/core/cursos/portadas.constantes.js", "utf8");
const SOURCE = fs.readFileSync("src/app/core/cursos/cursos.service.js", "utf8");
const COURSE_ID = "123e4567-e89b-42d3-a456-426614174000";

/*
  El delete se resuelve al await de la cadena (.delete().eq().select()), mientras
  que la sonda de existencia termina en .maybeSingle(). El harness expone ambas
  respuestas por separado para poder simular "cero filas" con y sin fila viva.
*/
function createHarness({ deleteResult, probeResult } = {}) {
  const calls = [];
  const logs = [];

  function crearConsulta() {
    return {
      delete() { calls.push(["delete"]); this.esBorrado = true; return this; },
      eq(field, value) { calls.push(["eq", field, value]); return this; },
      select(columns) { calls.push(["select", columns]); return this; },
      async maybeSingle() {
        calls.push(["maybeSingle"]);
        return probeResult;
      },
      then(resolve, reject) {
        calls.push(["await"]);
        return Promise.resolve(deleteResult).then(resolve, reject);
      },
    };
  }

  const context = {
    URL,
    console: { error: (...args) => logs.push(args) },
    supabaseClient: {
      from(name) {
        assert.equal(name, "cursos");
        calls.push(["from", name]);
        return crearConsulta();
      },
    },
  };
  vm.runInNewContext(CONSTANTS_SOURCE, context);
  vm.runInNewContext(SOURCE, context);
  return { calls, logs, eliminarCurso: context.eliminarCurso };
}

test("course delete asks for the affected rows and reports success without probing", async () => {
  const { calls, eliminarCurso } = createHarness({
    deleteResult: { data: [{ id: COURSE_ID }], error: null },
  });
  const result = await eliminarCurso(COURSE_ID);

  assert.equal(result.ok, true);
  assert.equal(result.id, COURSE_ID);
  assert.equal(result.yaNoExistia, undefined);
  assert.ok(
    calls.some((call) => call[0] === "select" && call[1] === "id"),
    "el delete debe pedir select(\"id\") para distinguir filas borradas de RLS"
  );
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "id" && call[2] === COURSE_ID));
  assert.equal(calls.filter((call) => call[0] === "maybeSingle").length, 0);
});

test("course delete reports forbidden when no row was deleted but the course still exists", async () => {
  const { calls, eliminarCurso } = createHarness({
    deleteResult: { data: [], error: null },
    probeResult: { data: { id: COURSE_ID }, error: null },
  });
  const result = await eliminarCurso(COURSE_ID);

  assert.equal(result.ok, false);
  assert.equal(result.codigo, "forbidden");
  assert.equal(result.mensaje, "No tienes permisos para eliminar cursos.");
  assert.equal(calls.filter((call) => call[0] === "maybeSingle").length, 1);
});

test("course delete is idempotent when the course was already gone", async () => {
  const { eliminarCurso } = createHarness({
    deleteResult: { data: [], error: null },
    probeResult: { data: null, error: null },
  });
  const result = await eliminarCurso(COURSE_ID);

  assert.equal(result.ok, true);
  assert.equal(result.id, COURSE_ID);
  assert.equal(result.yaNoExistia, true);
});

test("course delete surfaces the PostgREST code and logs without leaking the id", async () => {
  const { logs, eliminarCurso } = createHarness({
    deleteResult: { data: null, error: { code: "42501", name: "PostgrestError" } },
  });
  const result = await eliminarCurso(COURSE_ID);

  assert.equal(result.ok, false);
  assert.equal(result.codigo, "42501");
  assert.equal(result.mensaje, "No se pudo eliminar el curso.");
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].contexto, "eliminar");
  assert.equal(JSON.stringify(logs[0][1]).includes(COURSE_ID), false);
});

test("course delete falls back to delete_failed when the error carries no code", async () => {
  const { eliminarCurso } = createHarness({
    deleteResult: { data: null, error: { name: "TypeError" } },
  });
  const result = await eliminarCurso(COURSE_ID);

  assert.equal(result.codigo, "delete_failed");
});

test("course delete reports delete_unverified when the existence probe fails", async () => {
  const { logs, eliminarCurso } = createHarness({
    deleteResult: { data: [], error: null },
    probeResult: { data: null, error: { code: "PGRST301" } },
  });
  const result = await eliminarCurso(COURSE_ID);

  assert.equal(result.ok, false);
  assert.equal(result.codigo, "delete_unverified");
  assert.match(result.mensaje, /Recarga la página/);
  assert.equal(logs[0][1].contexto, "eliminar-verificar");
});

test("course delete rejects invalid ids before touching Supabase", async () => {
  for (const id of ["", "   ", null, undefined, 42, {}]) {
    const { calls, eliminarCurso } = createHarness({
      deleteResult: { data: [{ id: COURSE_ID }], error: null },
    });
    const result = await eliminarCurso(id);

    assert.equal(result.ok, false, `id inválido: ${JSON.stringify(id)}`);
    assert.equal(result.codigo, "invalid_course_id");
    assert.equal(calls.length, 0);
  }
});

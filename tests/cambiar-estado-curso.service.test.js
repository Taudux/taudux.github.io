const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const CONSTANTS_SOURCE = fs.readFileSync("src/app/core/cursos/portadas.constantes.js", "utf8");
const SOURCE = fs.readFileSync("src/app/core/cursos/cursos.service.js", "utf8");
const COURSE_ID = "123e4567-e89b-42d3-a456-426614174000";

function createHarness({ data, error } = {}) {
  const calls = [];
  const logs = [];
  const query = {
    update(value) { calls.push(["update", value]); return this; },
    eq(field, value) { calls.push(["eq", field, value]); return this; },
    select(columns) { calls.push(["select", columns]); return this; },
    async maybeSingle() {
      calls.push(["maybeSingle"]);
      return { data: data ?? null, error: error ?? null };
    },
  };
  const context = {
    URL,
    console: { error: (...args) => logs.push(args) },
    supabaseClient: {
      from(name) {
        assert.equal(name, "cursos");
        calls.push(["from", name]);
        return query;
      },
    },
  };
  vm.runInNewContext(CONSTANTS_SOURCE, context);
  vm.runInNewContext(SOURCE, context);
  return { calls, logs, actualizarEstadoCurso: context.actualizarEstadoCurso };
}

test("changes only the estado column for the target row", async () => {
  const { calls, actualizarEstadoCurso } = createHarness({
    data: { id: COURSE_ID, estado: "archivado" },
  });
  const result = await actualizarEstadoCurso(COURSE_ID, "archivado");

  assert.equal(result.ok, true);
  assert.equal(result.data.id, COURSE_ID);
  assert.equal(result.data.estado, "archivado");
  const update = calls.find(([name]) => name === "update")[1];
  assert.equal(update.estado, "archivado");
  assert.equal(Object.keys(update).length, 1, "no debe tocar otras columnas");
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "id" && call[2] === COURSE_ID));
});

test("rejects a state outside the allowed set before touching Supabase", async () => {
  const { calls, actualizarEstadoCurso } = createHarness();
  const result = await actualizarEstadoCurso(COURSE_ID, "eliminado");

  assert.equal(result.ok, false);
  assert.equal(result.codigo, "invalid_estado");
  assert.equal(calls.length, 0);
});

test("rejects invalid ids before touching Supabase", async () => {
  for (const id of ["", "   ", null, undefined, 42, {}]) {
    const { calls, actualizarEstadoCurso } = createHarness({ data: { id: COURSE_ID } });
    const result = await actualizarEstadoCurso(id, "publicado");

    assert.equal(result.ok, false, `id inválido: ${JSON.stringify(id)}`);
    assert.equal(result.codigo, "invalid_course_id");
    assert.equal(calls.length, 0);
  }
});

test("reports forbidden when RLS blocks the update and no row comes back", async () => {
  const { actualizarEstadoCurso } = createHarness({ data: null });
  const result = await actualizarEstadoCurso(COURSE_ID, "publicado");

  assert.equal(result.ok, false);
  assert.equal(result.codigo, "forbidden");
  assert.match(result.mensaje, /No tienes permisos/);
});

test("surfaces the PostgREST error code and logs without leaking the id", async () => {
  const { logs, actualizarEstadoCurso } = createHarness({ error: { code: "42501" } });
  const result = await actualizarEstadoCurso(COURSE_ID, "publicado");

  assert.equal(result.ok, false);
  assert.equal(result.codigo, "42501");
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].contexto, "actualizar-estado");
  assert.equal(JSON.stringify(logs[0][1]).includes(COURSE_ID), false);
});

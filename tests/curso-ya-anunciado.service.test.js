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
  const context = {
    URL,
    console: { error: (...args) => logs.push(args) },
    supabaseClient: {
      async rpc(name, args) {
        calls.push(["rpc", name, args]);
        return { data: data ?? null, error: error ?? null };
      },
    },
  };
  vm.runInNewContext(CONSTANTS_SOURCE, context);
  vm.runInNewContext(SOURCE, context);
  return { calls, logs, cursoYaAnunciado: context.cursoYaAnunciado };
}

test("calls the curso_anunciado RPC with the course id and returns its boolean", async () => {
  const { calls, cursoYaAnunciado } = createHarness({ data: true });
  const result = await cursoYaAnunciado(COURSE_ID);

  assert.equal(result.ok, true);
  assert.equal(result.data, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["rpc", "curso_anunciado"]);
  assert.equal(calls[0][2].p_curso_id, COURSE_ID);
});

test("coerces a falsy RPC payload to a strict boolean", async () => {
  const { cursoYaAnunciado } = createHarness({ data: false });
  const result = await cursoYaAnunciado(COURSE_ID);

  assert.equal(result.ok, true);
  assert.equal(result.data, false);
});

test("rejects invalid ids before touching Supabase", async () => {
  for (const id of ["", "   ", null, undefined, 42, {}]) {
    const { calls, cursoYaAnunciado } = createHarness({ data: true });
    const result = await cursoYaAnunciado(id);

    assert.equal(result.ok, false, `id inválido: ${JSON.stringify(id)}`);
    assert.equal(result.codigo, "invalid_course_id");
    assert.equal(calls.length, 0);
  }
});

test("surfaces the RPC error code and logs without leaking the id", async () => {
  const { logs, cursoYaAnunciado } = createHarness({ error: { code: "42501" } });
  const result = await cursoYaAnunciado(COURSE_ID);

  assert.equal(result.ok, false);
  assert.equal(result.codigo, "42501");
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].contexto, "curso-ya-anunciado");
  assert.equal(JSON.stringify(logs[0][1]).includes(COURSE_ID), false);
});

test("falls back to a generic code when the RPC error has none", async () => {
  const { cursoYaAnunciado } = createHarness({ error: {} });
  const result = await cursoYaAnunciado(COURSE_ID);

  assert.equal(result.ok, false);
  assert.equal(result.codigo, "curso_anunciado_failed");
});

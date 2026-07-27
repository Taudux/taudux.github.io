const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const SOURCE = fs.readFileSync("src/app/core/cursos/cursos.service.js", "utf8");
const COURSE_ID = "123e4567-e89b-42d3-a456-426614174000";
const OLD_URL = "https://legacy.example/old.jpg";
const PATH = `sha256/${"c".repeat(64)}.jpg`;
const MANAGED_URL = `https://yqkvgfqplmbbcebrivpt.supabase.co/storage/v1/object/public/course-covers/${PATH}`;
const ASSOCIATION_TOKEN = "123e4567-e89b-42d3-a456-426614174333";

function createHarness(data) {
  const calls = [];
  const query = {
    update(value) { calls.push(["update", value]); return this; },
    eq(field, value) { calls.push(["eq", field, value]); return this; },
    is(field, value) { calls.push(["is", field, value]); return this; },
    select() { calls.push(["select"]); return this; },
    async maybeSingle() { calls.push(["maybeSingle"]); return { data, error: null }; },
  };
  const context = {
    URL,
    console: { error() {} },
    supabaseClient: { from(name) { assert.equal(name, "cursos"); return query; } },
  };
  vm.runInNewContext(SOURCE, context);
  return { calls, actualizarCurso: context.actualizarCurso };
}

function fields() {
  return {
    titulo: "Course",
    descripcion: "Description",
    imagen_url: MANAGED_URL,
    imagen_storage_path: PATH,
    imagen_upload_token: ASSOCIATION_TOKEN,
    modalidad: "en_linea",
    fecha_inicio: "2026-08-01",
    fecha_fin: "2026-08-31",
    dias_semana: ["lun"],
    hora_inicio: "10:00",
    duracion_horas: "2",
    cupo_maximo: "20",
    costo: "500",
    instructor: "Teacher",
    proximamente: false,
    categoria_id: null,
    categoria: null,
    categoria_modo: "normalizado",
  };
}

test("course update persists the managed URL/path pair under the expected old pair", async () => {
  const persisted = { id: COURSE_ID, imagen_url: MANAGED_URL, imagen_storage_path: PATH };
  const { calls, actualizarCurso } = createHarness(persisted);
  const result = await actualizarCurso(COURSE_ID, fields(), { url: OLD_URL, path: null });
  assert.equal(result.ok, true);
  const update = calls.find(([name]) => name === "update")[1];
  assert.equal(update.imagen_url, MANAGED_URL);
  assert.equal(update.imagen_storage_path, PATH);
  assert.equal(update.imagen_upload_token, ASSOCIATION_TOKEN);
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "imagen_url" && call[2] === OLD_URL));
  assert.ok(calls.some((call) => call[0] === "is" && call[1] === "imagen_storage_path" && call[2] === null));
});

test("course update surfaces cover_conflict when the optimistic pair matches no row", async () => {
  const { actualizarCurso } = createHarness(null);
  const result = await actualizarCurso(COURSE_ID, fields(), { url: OLD_URL, path: null });
  assert.equal(result.ok, false);
  assert.equal(result.codigo, "cover_conflict");
  assert.match(result.mensaje, /otra sesión/);
});

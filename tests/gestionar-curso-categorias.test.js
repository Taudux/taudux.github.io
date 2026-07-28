const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE_PATH = "src/app/features/courses/gestionar-curso.categorias.js";
const SIN_ASIGNAR = "__sin_categoria__";
const PREFIJO_LEGACY = "__categoria_legacy__:";

class Option {
  constructor() {
    this.value = "";
    this.textContent = "";
    this.dataset = {};
  }
}

// Minimal <select> stand-in: enough DOM surface for the control under test.
class Select {
  constructor() {
    this.options = [];
    this.value = "";
    this.disabled = true;
  }

  set textContent(value) {
    if (value === "") this.options = [];
  }

  get textContent() { return ""; }

  appendChild(option) {
    this.options.push(option);
    return option;
  }
}

function crearControl() {
  const select = new Select();
  const context = {
    document: { createElement: () => new Option() },
    module: undefined,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(SOURCE_PATH), "utf8"), context);
  return { select, control: context.crearControlCategoriasCurso(select) };
}

// datosParaEnvio builds its object inside the vm realm, so copy it into this
// one before deep-comparing.
const plano = (valor) => ({ ...valor });
const etiquetas = (select) => select.options.map((option) => option.textContent);
const valores = (select) => select.options.map((option) => option.value);

test("only active categories are offered, plus the always-present none option", () => {
  const { select, control } = crearControl();
  control.reemplazarCategorias([
    { id: "id-ia", nombre: "IA", activo: true, legacy: false },
    { id: "id-off", nombre: "Retirada", activo: false, legacy: false },
  ]);
  control.poblar();

  assert.deepEqual(etiquetas(select), ["Sin categoría", "IA"]);
  assert.equal(select.value, SIN_ASIGNAR);
  assert.equal(select.disabled, false);
});

test("the course keeps its own category even when it is no longer active", () => {
  const { select, control } = crearControl();
  control.reemplazarCategorias([{ id: "id-ia", nombre: "IA", activo: true, legacy: false }]);
  control.poblar({
    categoria_id: "id-off",
    categoria_rel: { id: "id-off", nombre: "Retirada", activo: false },
  });

  assert.deepEqual(etiquetas(select), ["Sin categoría", "IA", "Retirada (inactiva)"]);
  assert.equal(select.value, "id-off");
});

test("a legacy course category is offered as inherited and selected", () => {
  const { select, control } = crearControl();
  control.reemplazarCategorias([{ id: "id-ia", nombre: "IA", activo: true, legacy: false }]);
  control.poblar({ categoria: "Robótica" });

  assert.deepEqual(etiquetas(select), ["Sin categoría", "IA", "Robótica (heredada)"]);
  assert.equal(select.value, `${PREFIJO_LEGACY}${encodeURIComponent("Robótica")}`);
});

test("a legacy name already listed is not duplicated as inherited", () => {
  const { select, control } = crearControl();
  control.reemplazarCategorias([{ id: null, nombre: "Análisis de datos", activo: null, legacy: true }]);
  control.poblar({ categoria: "análisis de DATOS" });

  assert.deepEqual(etiquetas(select), ["Sin categoría", "Análisis de datos"]);
});

test("the user's pick survives a reload that changed the option's identity", () => {
  const { select, control } = crearControl();
  control.reemplazarCategorias([{ id: null, nombre: "IA", activo: null, legacy: true }]);
  control.poblar();
  select.value = `${PREFIJO_LEGACY}IA`;
  const seleccion = control.obtenerSeleccion();

  // The migration landed between loads: the same name now travels as a UUID.
  control.reemplazarCategorias([{ id: "id-ia", nombre: "IA", activo: true, legacy: false }]);
  control.poblar(null, seleccion);

  assert.equal(select.value, "id-ia");
});

test("a preferred selection wins over the course's stored category", () => {
  const { select, control } = crearControl();
  control.reemplazarCategorias([
    { id: "id-ia", nombre: "IA", activo: true, legacy: false },
    { id: "id-datos", nombre: "Datos", activo: true, legacy: false },
  ]);
  control.poblar();
  select.value = "id-datos";
  const seleccion = control.obtenerSeleccion();

  control.poblar({ categoria_id: "id-ia" }, seleccion);
  assert.equal(select.value, "id-datos");
});

test("submission payload distinguishes normalized, legacy, and unset categories", () => {
  const { select, control } = crearControl();
  control.reemplazarCategorias([
    { id: "id-ia", nombre: "IA", activo: true, legacy: false },
    { id: null, nombre: "Heredada", activo: null, legacy: true },
  ]);
  control.poblar();

  select.value = "id-ia";
  assert.deepEqual(plano(control.datosParaEnvio("normalizado")), {
    categoria_id: "id-ia",
    categoria: "IA",
    categoria_modo: "normalizado",
  });

  select.value = `${PREFIJO_LEGACY}Heredada`;
  assert.deepEqual(plano(control.datosParaEnvio("normalizado")), {
    categoria_id: null,
    categoria: "Heredada",
    categoria_modo: "legacy",
  });

  select.value = SIN_ASIGNAR;
  assert.deepEqual(plano(control.datosParaEnvio("normalizado")), {
    categoria_id: null,
    categoria: null,
    categoria_modo: "normalizado",
  });
  assert.deepEqual(plano(control.datosParaEnvio("legacy")), {
    categoria_id: null,
    categoria: null,
    categoria_modo: "legacy",
  });
});

test("an unknown selected value reports no selection rather than a partial one", () => {
  const { select, control } = crearControl();
  control.reemplazarCategorias([]);
  control.poblar();
  select.value = "valor-que-no-existe";

  assert.equal(control.obtenerSeleccion(), null);
  assert.deepEqual(plano(control.datosParaEnvio("legacy")), {
    categoria_id: null,
    categoria: null,
    categoria_modo: "legacy",
  });
});

test("option values carry the mode so the service picks the right column", () => {
  const { select, control } = crearControl();
  control.reemplazarCategorias([
    { id: "id-ia", nombre: "IA", activo: true, legacy: false },
    { id: null, nombre: "Heredada", activo: null, legacy: true },
  ]);
  control.poblar();

  assert.deepEqual(select.options.map((option) => option.dataset.modo), [
    "ninguna",
    "normalizado",
    "legacy",
  ]);
  assert.deepEqual(valores(select), [
    SIN_ASIGNAR,
    "id-ia",
    `${PREFIJO_LEGACY}Heredada`,
  ]);
});

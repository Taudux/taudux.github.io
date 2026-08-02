const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE_PATH = "src/app/features/courses/gestionar-curso.temario.js";

/*
  El editor del temario es el único grupo repetible del formulario: crea y
  destruye sus propios controles, así que el harness necesita un DOM con
  querySelector/querySelectorAll de verdad, no los stubs de un <select> como en
  gestionar-curso-categorias.test.js.

  Lo central a blindar acá: que un temario malformado (de la base o de un
  borrador viejo) no rompa el editor, y que el orden de claves del payload sea
  estable — firmaSolicitud lo compara con JSON.stringify y un orden distinto
  haría que el formulario se crea sucio sin que el usuario toque nada.
*/

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.className = "";
    this.value = "";
    this.type = "";
    this.placeholder = "";
    this._textContent = "";
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = value;
    if (value === "") this.children = [];
  }

  append(...children) {
    this.children.push(...children);
    children.forEach((child) => { child.parent = this; });
  }

  appendChild(child) { this.append(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  click() { return this.listeners.click?.({ target: this }); }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  descendientes() {
    return this.children.flatMap((child) => [child, ...child.descendientes()]);
  }

  coincide(selector) {
    const porClase = selector.replace(/^\./, "");
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(porClase);
    const dato = /^\[data-campo="(.+)"\]$/.exec(selector);
    if (dato) return this.dataset.campo === dato[1];
    return false;
  }

  querySelector(selector) {
    return this.descendientes().find((nodo) => nodo.coincide(selector)) || null;
  }

  querySelectorAll(selector) {
    return this.descendientes().filter((nodo) => nodo.coincide(selector));
  }
}

function crearEditor() {
  const contenedor = new Element("div");
  const botonAgregar = new Element("button");
  const cambios = [];
  const context = {
    document: { createElement: (tag) => new Element(tag) },
    module: undefined,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(SOURCE_PATH), "utf8"), context);
  const control = context.crearControlTemarioCurso({
    contenedor,
    botonAgregar,
    alCambiar: () => cambios.push(true),
  });
  return { contenedor, botonAgregar, control, cambios };
}

// datosParaEnvio arma sus objetos dentro del realm del vm.
const plano = (valor) => JSON.parse(JSON.stringify(valor));

function escribir(modulo, campo, valor) {
  modulo.querySelector(`[data-campo="${campo}"]`).value = valor;
}

function escribirTemas(modulo, valores) {
  const campos = modulo.querySelectorAll(".courses__tema-campo");
  valores.forEach((valor, indice) => { campos[indice].value = valor; });
}

test("an empty editor sends an empty temario, never undefined", () => {
  const { control } = crearEditor();
  assert.deepEqual(plano(control.datosParaEnvio()), { temario: [] });
});

test("adding a module through the button creates a row and reports the change", () => {
  const { contenedor, botonAgregar, cambios } = crearEditor();

  botonAgregar.click();

  assert.equal(contenedor.children.length, 1);
  assert.equal(cambios.length, 1, "un click no dispara input/change: el aviso tiene que ser explícito");
});

test("a filled module round-trips with its keys in a fixed order, because firmaSolicitud compares JSON strings", () => {
  const { contenedor, botonAgregar, control } = crearEditor();
  botonAgregar.click();
  const modulo = contenedor.children[0];
  escribir(modulo, "titulo", "Estructuras de Pandas");
  escribir(modulo, "subtitulo", "Fundamentos.");
  escribirTemas(modulo, ["Series", "DataFrame"]);

  const enviado = plano(control.datosParaEnvio());

  assert.deepEqual(enviado, {
    temario: [{ titulo: "Estructuras de Pandas", subtitulo: "Fundamentos.", temas: ["Series", "DataFrame"] }],
  });
  assert.deepEqual(
    Object.keys(enviado.temario[0]),
    ["titulo", "subtitulo", "temas"],
    "el orden de claves es parte del contrato, no un detalle"
  );
});

test("a module the user opened but never titled is dropped whole instead of saving an empty card", () => {
  const { contenedor, botonAgregar, control } = crearEditor();
  botonAgregar.click();
  botonAgregar.click();
  escribir(contenedor.children[0], "titulo", "Módulo real");
  escribirTemas(contenedor.children[1], ["un tema huérfano"]);

  const { temario } = plano(control.datosParaEnvio());

  assert.equal(temario.length, 1);
  assert.equal(temario[0].titulo, "Módulo real");
});

test("blank topics are filtered out, and values are trimmed", () => {
  const { contenedor, botonAgregar, control } = crearEditor();
  botonAgregar.click();
  const modulo = contenedor.children[0];
  escribir(modulo, "titulo", "  Con espacios  ");
  escribir(modulo, "subtitulo", "  Bajada  ");
  escribirTemas(modulo, ["  Primero  ", "   ", "Tercero"]);

  const { temario } = plano(control.datosParaEnvio());

  assert.deepEqual(temario[0], { titulo: "Con espacios", subtitulo: "Bajada", temas: ["Primero", "Tercero"] });
});

test("removing a module renumbers the rest so no gap is left behind", () => {
  const { contenedor, botonAgregar } = crearEditor();
  botonAgregar.click();
  botonAgregar.click();
  botonAgregar.click();
  assert.deepEqual(
    contenedor.children.map((modulo) => modulo.querySelector(".courses__modulo-numero").textContent),
    ["01", "02", "03"]
  );

  contenedor.children[1].querySelector(".courses__modulo-eliminar").click();

  assert.equal(contenedor.children.length, 2);
  assert.deepEqual(
    contenedor.children.map((modulo) => modulo.querySelector(".courses__modulo-numero").textContent),
    ["01", "02"]
  );
});

test("each delete button names the module it removes, not a bare 'Eliminar'", () => {
  const { contenedor, botonAgregar } = crearEditor();
  botonAgregar.click();
  botonAgregar.click();

  const etiquetas = contenedor.children.map(
    (modulo) => modulo.querySelector(".courses__modulo-eliminar").attributes["aria-label"]
  );
  assert.deepEqual(etiquetas, ["Eliminar el módulo 01", "Eliminar el módulo 02"]);
});

test("adding and removing topics reports every change and drops the row from the payload", () => {
  const { contenedor, botonAgregar, control, cambios } = crearEditor();
  botonAgregar.click();
  const modulo = contenedor.children[0];
  escribir(modulo, "titulo", "Un módulo");

  modulo.querySelector(".courses__tema-agregar").click();
  const campos = modulo.querySelectorAll(".courses__tema-campo");
  assert.equal(campos.length, 4, "arranca con tres temas y se sumó uno");
  campos.forEach((campo, indice) => { campo.value = `tema ${indice}`; });

  modulo.querySelectorAll(".courses__tema-quitar")[0].click();

  const { temario } = plano(control.datosParaEnvio());
  assert.deepEqual(temario[0].temas, ["tema 1", "tema 2", "tema 3"]);
  assert.equal(cambios.length, 3, "agregar módulo, agregar tema y quitar tema");
});

test("poblar rebuilds the rows from a course instead of assuming the DOM already matches", () => {
  const { contenedor, control } = crearEditor();
  const curso = {
    temario: [
      { titulo: "Uno", subtitulo: "Primero", temas: ["a", "b"] },
      { titulo: "Dos", subtitulo: "Segundo", temas: ["c"] },
    ],
  };

  control.poblar(curso);

  assert.equal(contenedor.children.length, 2);
  assert.deepEqual(plano(control.datosParaEnvio()).temario, curso.temario);
});

test("poblar twice replaces the rows, it never appends to what was already there", () => {
  const { contenedor, control } = crearEditor();
  control.poblar({ temario: [{ titulo: "Uno", subtitulo: "", temas: [] }] });
  control.poblar({ temario: [{ titulo: "Otro", subtitulo: "", temas: [] }] });

  assert.equal(contenedor.children.length, 1);
  assert.equal(plano(control.datosParaEnvio()).temario[0].titulo, "Otro");
});

/*
  Un borrador de sessionStorage se valida solo por el sobre (leerBorrador en
  gestionar-curso.borrador.js no mira la forma interna), así que cualquier
  basura puede llegar hasta acá.
*/
test("poblar survives every malformed shape a stale draft or the jsonb column can hand it", () => {
  const casos = [
    undefined,
    null,
    { temario: null },
    { temario: "no soy un arreglo" },
    { temario: 42 },
    { temario: [null, undefined, 7, "texto"] },
    { temario: [{ temas: "no soy arreglo" }] },
    { temario: [{ titulo: 5, subtitulo: {}, temas: [1, "válido", null] }] },
  ];

  for (const caso of casos) {
    const { control } = crearEditor();
    assert.doesNotThrow(() => control.poblar(caso), `caso: ${JSON.stringify(caso)}`);
    assert.doesNotThrow(() => control.datosParaEnvio(), `payload tras: ${JSON.stringify(caso)}`);
  }
});

test("a module rescued from a malformed entry keeps the topics that were actually strings", () => {
  const { control } = crearEditor();
  control.poblar({ temario: [{ titulo: "Rescatado", temas: [1, "válido", null, "otro"] }] });

  const { temario } = plano(control.datosParaEnvio());
  assert.deepEqual(temario[0], { titulo: "Rescatado", subtitulo: "", temas: ["válido", "otro"] });
});

test("limpiar empties the editor without leaving a stale payload behind", () => {
  const { contenedor, control } = crearEditor();
  control.poblar({ temario: [{ titulo: "Uno", subtitulo: "", temas: [] }] });

  control.limpiar();

  assert.equal(contenedor.children.length, 0);
  assert.deepEqual(plano(control.datosParaEnvio()), { temario: [] });
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const SOURCE = fs.readFileSync("src/app/shared/confirm-dialog/confirm-dialog.js", "utf8");
const TITULO = "Introducción a Node práctico";

/*
  El repo no tiene DOM real en los tests, así que el documento falso implementa
  solo lo que usa el componente: creación de nodos, showModal/close y el ciclo de
  eventos cancel/close del <dialog> nativo.
*/
class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.className = "";
    this.classList = {
      add: (...names) => { this.className += ` ${names.join(" ")}`; },
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
    this.disabled = false;
    this.textContent = "";
    this.value = "";
    this.focused = false;
    this.conectado = false;
  }

  append(...children) { this.children.push(...children); children.forEach((child) => { child.parent = this; }); }
  appendChild(child) { this.append(child); child.conectado = true; return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  emitir(type, evento = {}) { (this.listeners[type] || []).forEach((listener) => listener({ target: this, ...evento })); }
  focus() { this.focused = true; this.documento.activeElement = this; }
  remove() {
    this.conectado = false;
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
  }

  // Equivalentes mínimos del <dialog> nativo.
  showModal() { this.abierto = true; }
  close(valor) {
    if (!this.abierto) return;
    this.abierto = false;
    this.returnValue = valor === undefined ? this.returnValue || "" : valor;
    this.emitir("close");
  }
  // Esc: el UA dispara cancel y cierra con returnValue vacío.
  presionarEscape() { this.emitir("cancel"); this.returnValue = ""; this.abierto = false; this.emitir("close"); }
}

function createHarness({ sinShowModal = false } = {}) {
  const errores = [];
  const body = new Element("body");
  const documento = {
    body,
    activeElement: null,
    createElement(tag) {
      const elemento = new Element(tag);
      elemento.documento = documento;
      if (sinShowModal && tag === "dialog") elemento.showModal = undefined;
      return elemento;
    },
  };
  body.documento = documento;

  const context = { console: { error: (...args) => errores.push(args) }, document: documento };
  vm.runInNewContext(SOURCE, context);

  function abrir(opciones = {}) {
    const promesa = context.crearDialogoConfirmacion({ documento }).abrir({
      titulo: "Eliminar curso",
      mensaje: "Esta acción no se puede deshacer.",
      textoEsperado: TITULO,
      etiquetaConfirmar: "Eliminar curso",
      ...opciones,
    });
    const dialogo = body.children[body.children.length - 1];
    const buscar = (clase) => {
      const encontrar = (nodo) => {
        if (nodo.className.includes(clase)) return nodo;
        for (const hijo of nodo.children) {
          const match = encontrar(hijo);
          if (match) return match;
        }
        return null;
      };
      return encontrar(dialogo);
    };
    return {
      promesa,
      dialogo,
      entrada: buscar("confirm-dialog__entrada"),
      ayuda: buscar("confirm-dialog__ayuda"),
      cancelar: buscar("confirm-dialog__cancelar"),
      confirmar: buscar("confirm-dialog__confirmar"),
    };
  }

  return { abrir, documento, body, errores };
}

function tipear(entrada, texto) {
  entrada.value = texto;
  entrada.emitir("input");
}

test("confirm button starts disabled and stays disabled while the text does not match", async () => {
  const { abrir } = createHarness();
  const { promesa, entrada, confirmar, cancelar } = abrir();

  assert.equal(confirmar.disabled, true);
  tipear(entrada, "Otro curso");
  assert.equal(confirmar.disabled, true);
  tipear(entrada, "");
  assert.equal(confirmar.disabled, true);

  cancelar.emitir("click");
  assert.equal(await promesa, false);
});

test("confirm button enables on an exact match and tolerates case and stray whitespace", async () => {
  for (const escrito of [TITULO, `  ${TITULO}  `, "introducción a NODE   práctico", "INTRODUCCIÓN A NODE PRÁCTICO"]) {
    const { abrir } = createHarness();
    const { promesa, entrada, confirmar, ayuda, cancelar } = abrir();

    tipear(entrada, escrito);
    assert.equal(confirmar.disabled, false, `debía habilitarse con: ${escrito}`);
    assert.equal(ayuda.textContent, "El texto coincide.");

    cancelar.emitir("click");
    await promesa;
  }
});

test("accents are not normalized away, so a missing tilde keeps confirm disabled", async () => {
  const { abrir } = createHarness();
  const { promesa, entrada, confirmar, cancelar } = abrir();

  tipear(entrada, "Introduccion a Node practico");
  assert.equal(confirmar.disabled, true);

  cancelar.emitir("click");
  await promesa;
});

test("confirming resolves true and detaches the dialog", async () => {
  const { abrir, body } = createHarness();
  const { promesa, dialogo, entrada, confirmar } = abrir();

  tipear(entrada, TITULO);
  confirmar.emitir("click");

  assert.equal(await promesa, true);
  assert.equal(dialogo.conectado, false);
  assert.equal(body.children.includes(dialogo), false);
});

test("confirming is revalidated instead of trusting the disabled flag", async () => {
  const { abrir } = createHarness();
  const { promesa, entrada, confirmar, cancelar } = abrir();

  tipear(entrada, TITULO);
  entrada.value = "ya no coincide";
  confirmar.emitir("click");
  assert.equal(confirmar.disabled, false, "el botón sigue habilitado por el estado previo");

  cancelar.emitir("click");
  assert.equal(await promesa, false, "el click no debió confirmar con texto distinto");
});

test("cancel, Escape and a backdrop click all resolve false", async () => {
  const cancelado = createHarness().abrir();
  cancelado.cancelar.emitir("click");
  assert.equal(await cancelado.promesa, false);

  const escapado = createHarness().abrir();
  escapado.dialogo.presionarEscape();
  assert.equal(await escapado.promesa, false);

  const backdrop = createHarness().abrir();
  backdrop.dialogo.emitir("click");
  assert.equal(await backdrop.promesa, false);
});

test("a click inside the dialog does not close it", async () => {
  const { abrir } = createHarness();
  const { promesa, dialogo, entrada, cancelar } = abrir();

  dialogo.emitir("click", { target: entrada });
  assert.equal(dialogo.abierto, true);

  cancelar.emitir("click");
  await promesa;
});

test("focus starts on the input and returns to the trigger on close", async () => {
  const { abrir, documento } = createHarness();
  const disparador = documento.createElement("button");
  documento.activeElement = disparador;

  const { promesa, entrada, cancelar } = abrir();
  assert.equal(entrada.focused, true);

  cancelar.emitir("click");
  await promesa;
  assert.equal(disparador.focused, true);
});

test("a reopened dialog starts empty with confirm disabled", async () => {
  const { abrir } = createHarness();
  const primero = abrir();
  tipear(primero.entrada, TITULO);
  primero.cancelar.emitir("click");
  await primero.promesa;

  const segundo = abrir();
  assert.equal(segundo.entrada.value, "");
  assert.equal(segundo.confirmar.disabled, true);
  assert.equal(segundo.ayuda.textContent, "");

  segundo.cancelar.emitir("click");
  await segundo.promesa;
});

test("a missing showModal resolves false instead of confirming blindly", async () => {
  const { documento, body, errores } = createHarness({ sinShowModal: true });
  const context = { console: { error: (...args) => errores.push(args) }, document: documento };
  vm.runInNewContext(SOURCE, context);

  const resultado = await context.crearDialogoConfirmacion({ documento }).abrir({
    titulo: "Eliminar curso",
    mensaje: "Esta acción no se puede deshacer.",
    textoEsperado: TITULO,
  });

  assert.equal(resultado, false);
  assert.equal(body.children.length, 0, "el diálogo inservible no queda colgado del body");
  assert.equal(errores.length, 1);
});

test("the dialog is labelled and described by its own heading and message", async () => {
  const { abrir } = createHarness();
  const { promesa, dialogo, cancelar } = abrir();

  const encontrar = (id) => {
    const buscar = (nodo) => {
      if (nodo.id === id) return nodo;
      for (const hijo of nodo.children) {
        const match = buscar(hijo);
        if (match) return match;
      }
      return null;
    };
    return buscar(dialogo);
  };

  assert.equal(encontrar(dialogo.attributes["aria-labelledby"]).textContent, "Eliminar curso");
  assert.equal(encontrar(dialogo.attributes["aria-describedby"]).textContent, "Esta acción no se puede deshacer.");

  cancelar.emitir("click");
  await promesa;
});

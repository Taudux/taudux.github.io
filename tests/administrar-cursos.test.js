const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const SOURCE = fs.readFileSync("src/app/features/courses/administrar-cursos.js", "utf8");
const PRIMERO = { id: "curso-1", titulo: "Node práctico", categoria: "Backend", estado: "publicado" };
const SEGUNDO = { id: "curso-2", titulo: "React desde cero", categoria: "Frontend", estado: "publicado" };
const BORRADOR = {
  id: "curso-3", titulo: "Rust desde cero", categoria: "Backend", estado: "borrador",
  dias_semana: ["lun"], proximamente: false,
};
const BORRADOR_INCOMPLETO = {
  id: "curso-4", titulo: "Go desde cero", categoria: "Backend", estado: "borrador",
  dias_semana: [], proximamente: false,
};
const BORRADOR_PROXIMAMENTE = {
  id: "curso-5", titulo: "Kotlin desde cero", categoria: "Backend", estado: "borrador",
  dias_semana: [], proximamente: true,
};

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.className = "";
    this.classList = {
      add: (...names) => { this.className += ` ${names.join(" ")}`; },
      toggle: (name, on) => {
        const clases = new Set(this.className.split(/\s+/).filter(Boolean));
        if (on) clases.add(name); else clases.delete(name);
        this.className = Array.from(clases).join(" ");
      },
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
    this.disabled = false;
    this.textContent = "";
    this.focused = false;
  }

  append(...children) { this.children.push(...children); children.forEach((child) => { child.parent = this; }); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  click() { return this.listeners.click?.({ target: this }); }
  focus() { this.focused = true; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }

  querySelector(selector) {
    const match = /^\[data-curso-id="(.+)"\]$/.exec(selector);
    if (!match) return null;
    const buscar = (nodo) => {
      if (nodo.dataset?.cursoId === match[1]) return nodo;
      for (const hijo of nodo.children) {
        const encontrado = buscar(hijo);
        if (encontrado) return encontrado;
      }
      return null;
    };
    return buscar(this);
  }
}

function buscarTodos(root, predicate, acumulado = []) {
  if (predicate(root)) acumulado.push(root);
  root.children.forEach((child) => buscarTodos(child, predicate, acumulado));
  return acumulado;
}

function createHarness({
  cursos = [PRIMERO, SEGUNDO],
  listar,
  eliminar = async () => ({ ok: true }),
  cambiarEstado = async () => ({ ok: true }),
  confirmar = async () => true,
  yaAnunciado = async () => ({ ok: true, data: false }),
} = {}) {
  const lista = new Element("section");
  const cursoNuevo = new Element("a");
  cursoNuevo.id = "cursoNuevo";
  const registro = new Map([["cursoNuevo", cursoNuevo]]);
  const calls = {
    toasts: [], fallos: [], eliminados: [], cambiosEstado: [], confirmaciones: [], consultasAnuncio: [], listados: 0,
  };

  const context = {
    console,
    window: {},
    document: {
      // Busca en el árbol vivo primero: el controlador resuelve los botones por
      // id después de cada repintado, igual que en la página real.
      getElementById: (id) => buscarTodos(lista, (nodo) => nodo.id === id)[0] || registro.get(id) || null,
      createElement: (tag) => new Element(tag),
    },
  };

  vm.runInNewContext(SOURCE, context);
  // El módulo se autoarranca al cargarse; fuera de la página real eso falla por
  // falta de crearArranqueAdmin, y el harness usa el factory directamente.
  context.window.tauduxAdminCursos?.ready?.catch(() => {});

  const administrador = context.crearAdministradorCursos({
    lista,
    listar: listar || (async () => { calls.listados += 1; return { ok: true, data: cursos }; }),
    eliminar: async (id) => { calls.eliminados.push(id); return eliminar(id); },
    cambiarEstado: async (id, estado) => { calls.cambiosEstado.push([id, estado]); return cambiarEstado(id, estado); },
    confirmar: async (opciones) => { calls.confirmaciones.push(opciones); return confirmar(opciones); },
    yaAnunciado: async (id) => { calls.consultasAnuncio.push(id); return yaAnunciado(id); },
    notificar: (...args) => calls.toasts.push(args),
    reportarFallo: (...args) => calls.fallos.push(args),
    iniciarTiempo: () => 0,
    enfocar: (id) => { calls.ultimoFoco = id; registro.get(id)?.focus(); },
  });

  return { administrador, lista, calls, registro, cursoNuevo };
}

function botonEliminar(lista, id) {
  return buscarTodos(lista, (nodo) => nodo.id === `curso-eliminar-${id}`)[0];
}

function botonEstado(lista, id) {
  return buscarTodos(lista, (nodo) => nodo.id === `curso-estado-${id}`)[0];
}

test("the admin grid renders one labelled delete button per course", async () => {
  const { administrador, lista } = createHarness();
  await administrador.cargarCursos();

  const botones = buscarTodos(lista, (nodo) => nodo.textContent === "Eliminar");
  assert.equal(botones.length, 2);
  assert.equal(botones[0].id, "curso-eliminar-curso-1");
  assert.equal(botones[0].attributes["aria-label"], "Eliminar curso Node práctico");
  assert.equal(botones[1].attributes["aria-label"], "Eliminar curso React desde cero");
});

test("the confirmation dialog is asked for the exact course title", async () => {
  const { administrador, lista, calls } = createHarness();
  await administrador.cargarCursos();
  await botonEliminar(lista, "curso-1").click();

  assert.equal(calls.confirmaciones.length, 1);
  assert.equal(calls.confirmaciones[0].textoEsperado, "Node práctico");
  assert.match(calls.confirmaciones[0].mensaje, /no se puede deshacer/);
});

test("cancelling the dialog deletes nothing and keeps the card", async () => {
  const { administrador, lista, calls } = createHarness({ confirmar: async () => false });
  await administrador.cargarCursos();
  await botonEliminar(lista, "curso-1").click();

  assert.equal(calls.eliminados.length, 0);
  assert.equal(calls.toasts.length, 0);
  assert.equal(calls.fallos.length, 0);
  assert.ok(botonEliminar(lista, "curso-1"));
});

test("confirming deletes the course, refetches and drops the card", async () => {
  let restantes = [PRIMERO, SEGUNDO];
  const { administrador, lista, calls } = createHarness({
    listar: async () => { calls.listados += 1; return { ok: true, data: restantes }; },
    eliminar: async () => { restantes = [SEGUNDO]; return { ok: true }; },
  });
  await administrador.cargarCursos();
  const listadosIniciales = calls.listados;

  await botonEliminar(lista, "curso-1").click();

  assert.deepEqual(calls.eliminados, ["curso-1"]);
  assert.deepEqual(calls.toasts[0], ["Curso eliminado.", "success"]);
  assert.equal(calls.listados, listadosIniciales + 1);
  assert.equal(botonEliminar(lista, "curso-1"), undefined);
  assert.ok(botonEliminar(lista, "curso-2"));
});

test("a course that was already gone reports it without pretending it was deleted now", async () => {
  const { administrador, lista, calls } = createHarness({
    eliminar: async () => ({ ok: true, yaNoExistia: true }),
  });
  await administrador.cargarCursos();
  await botonEliminar(lista, "curso-1").click();

  assert.deepEqual(calls.toasts[0], ["El curso ya no existía. Se actualizó la lista.", "success"]);
});

test("a second click is ignored while a deletion is in flight", async () => {
  let resolver;
  const { administrador, lista, calls } = createHarness({
    eliminar: () => new Promise((resolve) => { resolver = resolve; }),
  });
  await administrador.cargarCursos();

  const boton = botonEliminar(lista, "curso-1");
  const primera = boton.click();
  // El handler pasa por el diálogo asíncrono antes de tomar el candado.
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(lista.attributes["aria-busy"], "true");
  assert.equal(boton.disabled, true);
  assert.equal(lista.classList.contains("courses__list--ocupada"), true);

  await boton.click();
  assert.equal(calls.eliminados.length, 1, "el segundo click no debe disparar otro borrado");
  assert.equal(calls.confirmaciones.length, 1, "ni abrir un segundo diálogo");

  resolver({ ok: true });
  await primera;
  assert.equal(lista.attributes["aria-busy"], "false");
});

test("a forbidden delete surfaces the service message and keeps the card", async () => {
  const { administrador, lista, calls } = createHarness({
    eliminar: async () => ({ ok: false, codigo: "forbidden", mensaje: "No tienes permisos para eliminar cursos." }),
  });
  await administrador.cargarCursos();
  await botonEliminar(lista, "curso-1").click();

  assert.deepEqual(calls.toasts[0], ["No tienes permisos para eliminar cursos.", "error"]);
  assert.equal(calls.fallos[0][0], "course_delete");
  assert.equal(calls.fallos[0][1], null);
  assert.equal(calls.fallos[0][3], "forbidden");
  assert.ok(botonEliminar(lista, "curso-1"));
});

test("a thrown delete is reported as an exception and re-enables the controls", async () => {
  const { administrador, lista, calls } = createHarness({
    eliminar: async () => { throw new Error("network down"); },
  });
  await administrador.cargarCursos();
  await botonEliminar(lista, "curso-1").click();

  assert.equal(calls.fallos[0][3], "course_delete_exception");
  assert.match(calls.toasts[0][0], /Revisa tu conexión/);
  assert.equal(calls.toasts[0][1], "error");
  assert.equal(botonEliminar(lista, "curso-1").disabled, false);
  assert.equal(lista.attributes["aria-busy"], "false");
});

test("a failed refetch after a successful delete still removes the stale card", async () => {
  let fallar = false;
  const { administrador, lista, calls } = createHarness({
    listar: async () => {
      if (fallar) throw new Error("offline");
      return { ok: true, data: [PRIMERO, SEGUNDO] };
    },
    eliminar: async () => { fallar = true; return { ok: true }; },
  });
  await administrador.cargarCursos();
  await botonEliminar(lista, "curso-1").click();

  assert.equal(calls.fallos[0][3], "course_delete_reload_failed");
  assert.match(calls.toasts[1][0], /Recarga la página/);
  assert.equal(lista.querySelector('[data-curso-id="curso-1"]'), null);
});

test("focus moves to a neighbour after a delete and to the create link when the list empties", async () => {
  let restantes = [PRIMERO, SEGUNDO];
  const harness = createHarness({
    listar: async () => ({ ok: true, data: restantes }),
    eliminar: async (id) => { restantes = restantes.filter((curso) => curso.id !== id); return { ok: true }; },
  });
  await harness.administrador.cargarCursos();

  await botonEliminar(harness.lista, "curso-1").click();
  assert.equal(harness.calls.ultimoFoco, "curso-eliminar-curso-2");

  await botonEliminar(harness.lista, "curso-2").click();
  assert.equal(harness.calls.ultimoFoco, "cursoNuevo");
  assert.equal(harness.cursoNuevo.focused, true);
  assert.equal(harness.lista.children[0].textContent, "Aún no hay cursos publicados.");
});

test("a published course offers to archive it; a draft offers to publish it", async () => {
  const { administrador, lista } = createHarness({ cursos: [PRIMERO, BORRADOR] });
  await administrador.cargarCursos();

  const botonPublicado = botonEstado(lista, PRIMERO.id);
  assert.equal(botonPublicado.textContent, "Archivar");
  assert.equal(botonPublicado.attributes["aria-label"], `Archivar curso ${PRIMERO.titulo}`);

  const botonBorrador = botonEstado(lista, BORRADOR.id);
  assert.equal(botonBorrador.textContent, "Publicar");
  assert.equal(botonBorrador.attributes["aria-label"], `Publicar curso ${BORRADOR.titulo}`);
});

test("archiving a published course sends the archived target state and confirms without a dialog", async () => {
  const { administrador, lista, calls } = createHarness({ cursos: [PRIMERO] });
  await administrador.cargarCursos();
  await botonEstado(lista, PRIMERO.id).click();

  assert.deepEqual(calls.cambiosEstado, [[PRIMERO.id, "archivado"]]);
  assert.equal(calls.confirmaciones.length, 0, "archivar no debe abrir el diálogo de confirmación por tipeo");
  assert.deepEqual(calls.toasts[0], ["Curso archivado.", "success"]);
});

test("publishing a draft sends the published target state and refetches the list", async () => {
  let restantes = [BORRADOR];
  const { administrador, lista, calls } = createHarness({
    cursos: [BORRADOR],
    listar: async () => { calls.listados += 1; return { ok: true, data: restantes }; },
    cambiarEstado: async (id) => {
      restantes = restantes.map((curso) => (curso.id === id ? { ...curso, estado: "publicado" } : curso));
      return { ok: true, data: { id, estado: "publicado" } };
    },
  });
  await administrador.cargarCursos();
  const listadosIniciales = calls.listados;
  await botonEstado(lista, BORRADOR.id).click();

  assert.deepEqual(calls.cambiosEstado, [[BORRADOR.id, "publicado"]]);
  assert.deepEqual(calls.toasts[0], ["Curso publicado.", "success"]);
  assert.equal(calls.listados, listadosIniciales + 1);
  assert.equal(botonEstado(lista, BORRADOR.id).textContent, "Archivar");
});

test("a failed state change surfaces the service message and keeps the card as-is", async () => {
  const { administrador, lista, calls } = createHarness({
    cursos: [PRIMERO],
    cambiarEstado: async () => ({ ok: false, codigo: "forbidden", mensaje: "No tienes permisos para modificar este curso, o ya no existe." }),
  });
  await administrador.cargarCursos();
  await botonEstado(lista, PRIMERO.id).click();

  assert.deepEqual(calls.toasts[0], ["No tienes permisos para modificar este curso, o ya no existe.", "error"]);
  assert.equal(calls.fallos[0][0], "course_state_change");
  assert.equal(calls.fallos[0][3], "forbidden");
  assert.equal(botonEstado(lista, PRIMERO.id).textContent, "Archivar");
});

test("a second click is ignored while a state change is in flight", async () => {
  let resolver;
  const { administrador, lista, calls } = createHarness({
    cursos: [PRIMERO],
    cambiarEstado: () => new Promise((resolve) => { resolver = resolve; }),
  });
  await administrador.cargarCursos();

  const boton = botonEstado(lista, PRIMERO.id);
  const primera = boton.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(boton.disabled, true);
  await boton.click();
  assert.equal(calls.cambiosEstado.length, 1, "el segundo click no debe disparar otro cambio de estado");

  resolver({ ok: true });
  await primera;
});

test("deleting and changing state share the same in-flight lock", async () => {
  let resolver;
  const { administrador, lista, calls } = createHarness({
    cursos: [PRIMERO],
    eliminar: () => new Promise((resolve) => { resolver = resolve; }),
  });
  await administrador.cargarCursos();

  botonEliminar(lista, PRIMERO.id).click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(botonEstado(lista, PRIMERO.id).disabled, true);
  await botonEstado(lista, PRIMERO.id).click();
  assert.equal(calls.cambiosEstado.length, 0, "el cambio de estado no debe correr mientras el borrado está en vuelo");

  resolver({ ok: true });
});

test("publishing a draft with no weekday assigned is blocked before touching the service", async () => {
  const { administrador, lista, calls } = createHarness({ cursos: [BORRADOR_INCOMPLETO] });
  await administrador.cargarCursos();
  await botonEstado(lista, BORRADOR_INCOMPLETO.id).click();

  assert.equal(calls.cambiosEstado.length, 0, "no debe llamar a cambiarEstado con un curso incompleto");
  assert.match(calls.toasts[0][0], /días de la semana/);
  assert.equal(calls.toasts[0][1], "error");
  assert.equal(calls.fallos.length, 0, "es un rechazo de validación, no una falla de operación");
});

test("a draft marked próximamente can be published without weekdays", async () => {
  const { administrador, lista, calls } = createHarness({ cursos: [BORRADOR_PROXIMAMENTE] });
  await administrador.cargarCursos();
  await botonEstado(lista, BORRADOR_PROXIMAMENTE.id).click();

  assert.deepEqual(calls.cambiosEstado, [[BORRADOR_PROXIMAMENTE.id, "publicado"]]);
});

test("archiving an incomplete course is never blocked by the weekday guard", async () => {
  const cursoPublicadoIncompleto = { ...PRIMERO, dias_semana: [] };
  const { administrador, lista, calls } = createHarness({ cursos: [cursoPublicadoIncompleto] });
  await administrador.cargarCursos();
  await botonEstado(lista, cursoPublicadoIncompleto.id).click();

  assert.deepEqual(calls.cambiosEstado, [[cursoPublicadoIncompleto.id, "archivado"]]);
});

// --- Migración 0018: publicar siempre reencola el aviso, así que ahora pasa
// por el diálogo de confirmación simple (sin tipeo) antes de mutar nada.
// Migración 0026: ese aviso es solo push, ya no correo. ---

test("publishing from the panel opens the confirmation dialog with the first-time wording", async () => {
  const { administrador, lista, calls } = createHarness({
    cursos: [BORRADOR],
    yaAnunciado: async () => ({ ok: true, data: false }),
  });
  await administrador.cargarCursos();
  await botonEstado(lista, BORRADOR.id).click();

  assert.equal(calls.confirmaciones.length, 1);
  assert.equal(calls.confirmaciones[0].titulo, "Publicar curso");
  assert.match(calls.confirmaciones[0].mensaje, /Se enviará una notificación push/);
  assert.doesNotMatch(calls.confirmaciones[0].mensaje, /correo/i);
  assert.doesNotMatch(calls.confirmaciones[0].mensaje, /10 minutos/);
  assert.equal(calls.confirmaciones[0].textoEsperado, undefined, "publicar no exige tipeo");
  assert.deepEqual(calls.consultasAnuncio, [BORRADOR.id]);
  assert.deepEqual(calls.cambiosEstado, [[BORRADOR.id, "publicado"]]);
});

test("publishing an already-announced course uses the resend wording, not the first-time one", async () => {
  const { administrador, lista, calls } = createHarness({
    cursos: [BORRADOR],
    yaAnunciado: async () => ({ ok: true, data: true }),
  });
  await administrador.cargarCursos();
  await botonEstado(lista, BORRADOR.id).click();

  assert.equal(calls.confirmaciones.length, 1);
  assert.match(calls.confirmaciones[0].mensaje, /ya fue anunciado antes/);
  assert.match(calls.confirmaciones[0].mensaje, /todos los suscritos/);
  assert.doesNotMatch(calls.confirmaciones[0].mensaje, /correo/i);
  assert.deepEqual(calls.cambiosEstado, [[BORRADOR.id, "publicado"]]);
});

test("a failed announcement check falls back to the conservative wording without blocking publish", async () => {
  const { administrador, lista, calls } = createHarness({
    cursos: [BORRADOR],
    yaAnunciado: async () => { throw new Error("network down"); },
  });
  await administrador.cargarCursos();
  await botonEstado(lista, BORRADOR.id).click();

  assert.equal(calls.confirmaciones.length, 1);
  assert.match(calls.confirmaciones[0].mensaje, /No pudimos verificar/);
  assert.doesNotMatch(calls.confirmaciones[0].mensaje, /correo/i);
  assert.deepEqual(calls.cambiosEstado, [[BORRADOR.id, "publicado"]], "el fallo del RPC no bloquea la publicación");
});

test("cancelling the publish confirmation calls neither cambiarEstado nor leaves the list locked", async () => {
  const { administrador, lista, calls } = createHarness({
    cursos: [BORRADOR],
    confirmar: async () => false,
  });
  await administrador.cargarCursos();
  await botonEstado(lista, BORRADOR.id).click();

  assert.equal(calls.cambiosEstado.length, 0, "cancelar no debe cambiar el estado del curso");
  assert.equal(calls.toasts.length, 0);
  assert.equal(lista.attributes["aria-busy"], "false", "cancelar no debe dejar la lista trabada");
  assert.equal(botonEstado(lista, BORRADOR.id).disabled, false);
});

test("archiving still opens no dialog and never queries the announcement state", async () => {
  const { administrador, lista, calls } = createHarness({ cursos: [PRIMERO] });
  await administrador.cargarCursos();
  await botonEstado(lista, PRIMERO.id).click();

  assert.equal(calls.confirmaciones.length, 0);
  assert.equal(calls.consultasAnuncio.length, 0);
  assert.deepEqual(calls.cambiosEstado, [[PRIMERO.id, "archivado"]]);
});

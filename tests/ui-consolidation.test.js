const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.className = "";
    this.classList = { add: (...names) => { this.className += ` ${names.join(" ")}`; } };
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
  }

  get childElementCount() { return this.children.length; }
  append(...children) { this.children.push(...children); children.forEach((child) => { child.parent = this; }); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  click() { return this.listeners.click?.({ target: this }); }
  focus() { this.focused = true; }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
  closest(selector) {
    let current = this.parent;
    while (current) {
      if (selector === ".courses__card" && current.className.includes("courses__card")) return current;
      current = current.parent;
    }
    return null;
  }
}

function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

function createCatalogHarness({ admin = false } = {}) {
  const elements = Object.fromEntries([
    "cursosLista", "adminControls", "cursosEstado", "cursosEstadoMensaje", "cursosReintentar",
  ].map((id) => [id, new Element("div")]));
  elements.adminControls.hidden = true;
  elements.cursosEstado.hidden = true;
  const calls = { details: 0, deleted: [] };
  const course = { id: "course/id", titulo: "Node práctico", modalidad: "remoto", costo: 0 };
  const window = {
    location: { href: "https://taudux.test/cursos.html", pathname: "/cursos.html", search: "", hash: "" },
    history: { replaceState() {} },
    confirm: () => true,
  };
  const context = {
    URL,
    console,
    window,
    document: {
      getElementById: (id) => elements[id],
      createElement: (tag) => new Element(tag),
    },
    obtenerSesion: async () => ({ user: { id: "user" } }),
    esAdmin: async () => admin,
    listarCursos: async () => ({ ok: true, data: [course] }),
    eliminarCurso: async (id) => { calls.deleted.push(id); return { ok: true }; },
    mostrarToast(message) { if (message.includes("disponible pronto")) calls.details += 1; },
    etiquetaModalidad: () => "En línea",
    formatearRangoFechas: () => null,
    formatearHorario: () => null,
    formatearCosto: () => "Gratis",
    esUrlSegura: () => false,
    urlLoginConDestino: () => "/login",
  };
  window.window = window;
  vm.runInNewContext(read("src/app/features/courses/cursos.js"), context);
  return { calls, course, elements, window };
}

test("catalog renders admin controls and card actions only for admins", async () => {
  const nonAdmin = createCatalogHarness();
  await nonAdmin.window.tauduxCursosCatalog.ready;
  assert.equal(nonAdmin.elements.adminControls.hidden, true);
  assert.equal(find(nonAdmin.elements.cursosLista, (element) => element.textContent === "Editar"), null);

  const admin = createCatalogHarness({ admin: true });
  await admin.window.tauduxCursosCatalog.ready;
  assert.equal(admin.elements.adminControls.hidden, false);
  assert.ok(find(admin.elements.cursosLista, (element) => element.textContent === "Editar"));
});

test("admin card uses the edit route and deletion without activating details", async () => {
  const { calls, course, elements, window } = createCatalogHarness({ admin: true });
  await window.tauduxCursosCatalog.ready;
  const edit = find(elements.cursosLista, (element) => element.textContent === "Editar");
  const remove = find(elements.cursosLista, (element) => element.textContent === "Eliminar");
  const hitArea = find(elements.cursosLista, (element) => element.className === "courses__card-hit-area");

  assert.equal(edit.href, "/src/app/features/courses/editar-curso.html?id=course%2Fid");
  assert.equal(remove.tagName, "BUTTON");
  assert.equal(remove.type, "button");
  await remove.click();
  assert.deepEqual(calls.deleted, [course.id]);
  assert.equal(calls.details, 0);
  await hitArea.click();
  assert.equal(calls.details, 1);
});

test("operation failures get one visible generic report unless an alert is already visible", async () => {
  const listeners = {};
  const messages = [];
  const context = {
    window: {
      addEventListener: (type, listener) => { listeners[type] = listener; },
      scrollY: 0,
    },
    document: {
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
    },
    mostrarToast: (...args) => messages.push(args),
    queueMicrotask,
  };
  vm.runInNewContext(read("src/app/shared/navbar/navbar.js"), context);
  listeners["taudux:operation-error"]({ detail: { operation: "course_delete", code: "denied" } });
  await new Promise(queueMicrotask);
  assert.deepEqual(messages, [["No se pudo completar la operación. Intenta nuevamente.", "error"]]);

  context.document.querySelector = () => new Element("section");
  listeners["taudux:operation-error"]({ detail: { operation: "course_delete", code: "denied" } });
  await new Promise(queueMicrotask);
  assert.equal(messages.length, 1);
});

test("live source contains no references to removed pages", () => {
  const source = fs.readdirSync(path.join(ROOT, "src"), { recursive: true })
    .filter((file) => /\.(?:html|js|css)$/.test(file))
    .map((file) => read(path.join("src", file)))
    .join("\n");
  assert.doesNotMatch(source, /(?:explorar|gestionar-cursos)\.html/);
  assert.equal(fs.existsSync(path.join(ROOT, "src/app/features/explore/explorar.html")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "src/app/features/courses/gestionar-cursos.html")), false);
});

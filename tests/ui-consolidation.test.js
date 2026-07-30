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

function createCatalogHarness({ admin = false, authenticated = true } = {}) {
  const elements = Object.fromEntries([
    "cursosLista", "adminControls", "cursosEstado", "cursosEstadoMensaje", "cursosReintentar",
  ].map((id) => [id, new Element("div")]));
  elements.adminControls.hidden = true;
  elements.cursosEstado.hidden = true;
  const calls = { sessions: 0, toasts: [], loginUrls: 0 };
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
    obtenerSesion: async () => {
      calls.sessions += 1;
      return authenticated ? { user: { id: "user" } } : null;
    },
    esAdmin: async () => admin,
    listarCursos: async () => ({ ok: true, data: [course] }),
    mostrarToast: (...args) => calls.toasts.push(args),
    etiquetaModalidad: () => "En línea",
    formatearRangoFechas: () => null,
    formatearHorario: () => null,
    formatearCosto: () => "Gratis",
    esUrlSegura: () => false,
    urlLoginConDestino: () => { calls.loginUrls += 1; return "/login"; },
  };
  window.window = window;
  vm.runInNewContext(read("src/app/core/telemetry/operaciones.js"), context);
  vm.runInNewContext(read("src/app/features/courses/cursos.js"), context);
  return { calls, course, elements, window };
}

test("catalog renders admin controls for admins only; cards never show edit/delete", async () => {
  const nonAdmin = createCatalogHarness();
  await nonAdmin.window.tauduxCursosCatalog.ready;
  assert.equal(nonAdmin.elements.adminControls.hidden, true);
  assert.equal(find(nonAdmin.elements.cursosLista, (element) => element.textContent === "Editar"), null);

  const admin = createCatalogHarness({ admin: true });
  await admin.window.tauduxCursosCatalog.ready;
  assert.equal(admin.elements.adminControls.hidden, false);
  assert.equal(find(admin.elements.cursosLista, (element) => element.textContent === "Editar"), null);
  assert.equal(find(admin.elements.cursosLista, (element) => element.textContent === "Eliminar"), null);
});

test("public course details behave identically without an authentication gate", async () => {
  const contexts = [
    createCatalogHarness({ authenticated: false }),
    createCatalogHarness({ authenticated: true }),
  ];

  for (const { calls, elements, window } of contexts) {
    await window.tauduxCursosCatalog.ready;
    const sessionsBeforeActivation = calls.sessions;
    const hitArea = find(elements.cursosLista, (element) => element.className === "courses__card-hit-area");

    await hitArea.click();

    assert.equal(calls.sessions, sessionsBeforeActivation);
    assert.equal(calls.loginUrls, 0);
    assert.equal(window.location.href, "/#contacto");
    assert.deepEqual(calls.toasts, []);
  }
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

test("catalog cover uses the 35 percent 260px desktop target and stacks at exactly 760px", () => {
  const css = read("src/app/features/courses/cursos.css");
  assert.match(css, /grid-template-columns:\s*minmax\(260px,\s*35%\)\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.courses__card--catalog\s*{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.courses__card-media\s*{[\s\S]*?aspect-ratio:\s*4\s*\/\s*3/);
  assert.match(css, /\.courses__card-body\s*{[\s\S]*?min-width:\s*0/);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*761px\)/);
});

test("the course admin grid wires deletion through the typed confirmation dialog", () => {
  const html = read("src/app/features/courses/administrar-cursos.html");
  assert.match(html, /shared\/confirm-dialog\/confirm-dialog\.js/);
  assert.match(html, /shared\/confirm-dialog\/confirm-dialog\.css/);
  assert.match(html, /id="cursoNuevo"/);
  assert.doesNotMatch(html, /Eliminar y el sello/);

  /*
    Storage nunca se muta desde el cliente: el trigger cursos_enqueue_cover_cleanup
    encola la portada al borrar la fila, y las policies de storage.objects rechazan
    cualquier mutación desde el navegador.
  */
  const js = read("src/app/features/courses/administrar-cursos.js");
  assert.doesNotMatch(js, /portadasCurso/);
  assert.doesNotMatch(html, /portadas-curso\.service\.js/);
});

test("the admin grid keeps its track width when only one course is left", () => {
  const css = read("src/app/features/courses/cursos.css");
  /*
    auto-fit colapsaría las pistas vacías y estiraría la última tarjeta a todo el
    ancho, con una portada 4/3 de más de 600px de alto.
  */
  assert.match(css, /\.courses__list\s*{[\s\S]*?repeat\(auto-fill,/);
  assert.doesNotMatch(css, /\.courses__list\s*{[\s\S]*?repeat\(auto-fit,/);
  assert.match(css, /\.courses__empty\s*{[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
});

test("the confirmation dialog ships a backdrop and a reduced-motion fallback", () => {
  const css = read("src/app/shared/confirm-dialog/confirm-dialog.css");
  assert.match(css, /\.confirm-dialog::backdrop/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);

  const catalogCss = read("src/app/features/courses/cursos.css");
  assert.match(catalogCss, /\.courses__action:disabled/);
  assert.match(catalogCss, /\.courses__action\[aria-disabled="true"\][\s\S]*?pointer-events:\s*none/);
});

test("catalog and crop controls retain focus and reduced-motion alternatives", () => {
  const catalogCss = read("src/app/features/courses/cursos.css");
  const adminCss = read("src/app/features/courses/gestionar-cursos.css");
  assert.match(catalogCss, /courses__card-hit-area:focus-visible/);
  assert.match(catalogCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none/);
  assert.match(adminCss, /courses__cropper-canvas:focus-visible/);
  assert.match(adminCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

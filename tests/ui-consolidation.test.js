const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

// La descripción de la tarjeta se arma con <strong> y nodos de texto sueltos
// (agregarTextoConNegritas), no con una asignación directa a textContent.
class TextNode {
  constructor(data) { this.data = data; }
  get textContent() { return this.data; }
}

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
    this._textContent = "";
  }

  // Como en el DOM: leer concatena el subárbol, escribir lo reemplaza. Un
  // elemento sin hijos se comporta igual que antes de este cambio.
  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) { this._textContent = value; }

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

function createCatalogHarness({ admin = false, authenticated = true, course: cursoOverride } = {}) {
  const elements = Object.fromEntries([
    "cursosLista", "adminControls", "cursosEstado", "cursosEstadoMensaje", "cursosReintentar",
  ].map((id) => [id, new Element("div")]));
  elements.adminControls.hidden = true;
  elements.cursosEstado.hidden = true;
  const calls = { sessions: 0, toasts: [], loginUrls: 0 };
  const course = cursoOverride || { id: "course/id", titulo: "Node práctico", modalidad: "remoto", costo: 0 };
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
      createTextNode: (text) => new TextNode(text),
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
  // agregarTextoConNegritas se ejercita de verdad, no se stubea: es lo que evita
  // que la tarjeta muestre los asteriscos crudos de una descripción con énfasis.
  // Los formateadores sí siguen stubeados, así que se reponen después de cargar
  // el módulo real, que los define.
  const formateadoresStub = {
    etiquetaModalidad: context.etiquetaModalidad,
    formatearRangoFechas: context.formatearRangoFechas,
    formatearHorario: context.formatearHorario,
    formatearCosto: context.formatearCosto,
  };
  vm.runInNewContext(read("src/app/features/courses/curso-presentacion.js"), context);
  Object.assign(context, formateadoresStub);
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

  for (const { calls, course, elements, window } of contexts) {
    await window.tauduxCursosCatalog.ready;
    const sessionsBeforeActivation = calls.sessions;
    const hitArea = find(elements.cursosLista, (element) => element.className === "courses__card-hit-area");

    await hitArea.click();

    assert.equal(calls.sessions, sessionsBeforeActivation);
    assert.equal(calls.loginUrls, 0);
    assert.equal(window.location.href, `/app/features/courses/detalle-curso.html?id=${encodeURIComponent(course.id)}`);
    assert.deepEqual(calls.toasts, []);
  }
});

test("a card description with **emphasis** renders a real <strong>, never the raw asterisks", async () => {
  const curso = {
    id: "da175f1c-cae5-45f9-889c-f09a17aa10ed",
    titulo: "Análisis de Datos con Python",
    descripcion: "Está diseñado para formar **analistas de datos** competentes.",
    modalidad: "en_linea",
    costo: 0,
  };
  const { elements, window } = createCatalogHarness({ course: curso });
  await window.tauduxCursosCatalog.ready;

  const desc = find(elements.cursosLista, (element) => element.className === "courses__card-description");
  assert.ok(desc, "la tarjeta debe pintar la descripción");
  assert.equal(desc.textContent, "Está diseñado para formar analistas de datos competentes.");
  assert.doesNotMatch(desc.textContent, /\*\*/, "los asteriscos son marcado, no texto para el usuario");

  const negrita = desc.children.find((child) => child.tagName === "STRONG");
  assert.ok(negrita, "el énfasis tiene que ser un <strong> real");
  assert.equal(negrita.textContent, "analistas de datos");
});

test("every course card links to its own detail page, with an honest aria-label", async () => {
  const curso = {
    id: "da175f1c-cae5-45f9-889c-f09a17aa10ed",
    titulo: "Análisis de Datos con Python",
    modalidad: "en_linea",
    costo: 300,
  };
  const { elements, window } = createCatalogHarness({ course: curso });
  await window.tauduxCursosCatalog.ready;

  const hitArea = find(elements.cursosLista, (element) => element.className === "courses__card-hit-area");
  assert.equal(hitArea.attributes["aria-label"], "Ver detalles del curso: Análisis de Datos con Python");

  await hitArea.click();

  assert.equal(window.location.href, `/app/features/courses/detalle-curso.html?id=${curso.id}`);
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

test("the navigation panel drops site links whose label already exists as an anchor", () => {
  const context = {
    window: { addEventListener() {}, scrollY: 0 },
    document: {
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: (tagName) => new Element(tagName),
    },
    queueMicrotask,
  };
  vm.runInNewContext(`${read("src/app/shared/navbar/navbar.js")}\nthis.montarPanelNavegacion = montarPanelNavegacion;`, context);

  const lista = new Element("div");
  context.montarPanelNavegacion(lista, {
    anclas: [{ texto: "Herramientas", href: "#herramientas" }],
    enlaces: [
      { texto: "Cursos", href: "/app/features/courses/cursos.html", habilitado: true },
      { texto: "Herramientas", href: "/app/features/detector/detector.html", habilitado: true },
    ],
  });

  const etiquetas = lista.children.map((hijo) => hijo.textContent).filter(Boolean);
  assert.deepEqual(etiquetas, ["Herramientas", "Cursos"]);
  assert.equal(etiquetas.filter((texto) => texto === "Herramientas").length, 1);
});

test("dedupe by label intentionally hides the admin tools link behind a same-named anchor on the landing page", () => {
  /*
    Trade-off aceptado: en el landing, un admin que abre la hamburguesa ve
    "Herramientas" apuntando al ancla de sección (#herramientas), no al link
    real a detector.html — quedan con el mismo texto y el dedupe por texto
    descarta el segundo. El acceso a detector.html sigue disponible desde el
    menú de cuenta en desktop y desde la hamburguesa de cualquier otra página,
    que no tiene ese ancla. Este test documenta que la pérdida es intencional,
    no una regresión a corregir.
  */
  const context = {
    window: { addEventListener() {}, scrollY: 0 },
    document: {
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: (tagName) => new Element(tagName),
    },
    queueMicrotask,
  };
  vm.runInNewContext(`${read("src/app/shared/navbar/navbar.js")}\nthis.montarPanelNavegacion = montarPanelNavegacion;`, context);

  const lista = new Element("div");
  context.montarPanelNavegacion(lista, {
    anclas: [{ texto: "Herramientas", href: "#herramientas" }],
    enlaces: [
      { texto: "Herramientas", href: "/app/features/detector/detector.html", habilitado: true },
    ],
  });

  const enlaceHerramientas = lista.children.find((hijo) => hijo.textContent === "Herramientas");
  assert.equal(enlaceHerramientas.href, "#herramientas");
});

test("the navigation menu is revealed only on mobile", () => {
  const css = read("src/app/shared/navbar/navbar.css");
  /*
    .nav-menu--site se oculta en la regla base y solo se revela dentro del
    bloque de 760px: si esto se invierte, la hamburguesa aparece en desktop.
  */
  assert.match(css, /\.nav-menu--site\s*{[^}]*display:\s*none/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.nav-menu--site\s*{[^}]*display:\s*inline-block/);
});

test("mobile navigation lives only in the hamburger, and the legacy links panel is gone", () => {
  const css = read("src/app/shared/navbar/navbar.css");
  const js = read("src/app/shared/navbar/navbar.js");

  /* En desktop el grupo sigue siendo la única navegación de cursos/detector/privacidad. */
  assert.match(js, /nav-menu__group--nav/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.nav-menu__group--nav\s*{[^}]*display:\s*none/);
  assert.doesNotMatch(css.split(/@media\s*\(max-width:\s*760px\)/)[0], /\.nav-menu__group--nav\s*{[^}]*display:\s*none/);

  const fuente = `${css}\n${js}\n${read("src/index.html")}`;
  assert.doesNotMatch(fuente, /navbar__links--mobile-open/);
  assert.doesNotMatch(fuente, /navbar__toggle/);
  assert.doesNotMatch(css, /--z-mobile-menu|--z-mobile-toggle/);
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

test("the site width is one knob (--ancho-sitio) with a shared container utility", () => {
  const styles = read("src/styles.css");
  assert.match(styles, /--ancho-sitio:\s*1200px/);
  assert.match(styles, /\.u-contenedor\s*\{[^}]*max-inline-size:\s*var\(--ancho-sitio\)/);
});

test("--ancho-medio and --ancho-contenido derive from --ancho-sitio via calc(), not a resolved pixel value", () => {
  /*
    Si alguien "simplifica" el calc() a un número fijo, el sitio se ve
    idéntico hoy y la perilla deja de existir en silencio. Este test protege
    la derivación, no el valor resultante.
  */
  const styles = read("src/styles.css");
  assert.match(styles, /--ancho-medio:\s*calc\(\s*var\(--ancho-sitio\)/);
  assert.match(styles, /--ancho-contenido:\s*calc\(\s*var\(--ancho-sitio\)/);
});

test("--ancho-lectura stays independent of --ancho-sitio on purpose", () => {
  /*
    El límite de lectura (45-75 caracteres por línea) es función de la
    tipografía, no del ancho del sitio. Colgarlo de la misma perilla
    degradaría la prosa si el sitio creciera.
  */
  const styles = read("src/styles.css");
  const declaracion = styles.match(/--ancho-lectura:\s*([^;]+);/);
  assert.ok(declaracion, "--ancho-lectura debe estar declarada");
  assert.doesNotMatch(declaracion[1], /var\(--ancho-sitio\)/);
});

test("no page container declares a raw pixel width anymore — the utility owns it", () => {
  const cssSource = fs.readdirSync(path.join(ROOT, "src"), { recursive: true })
    .filter((file) => /\.css$/.test(file))
    .map((file) => read(path.join("src", file)))
    .join("\n");

  /*
    Cualquier selector cuyo nombre termine en __container, __panel o
    __content (los tres sufijos de contenedor de página del proyecto) no
    debe volver a declarar max-width/max-inline-size en píxeles crudos: ese
    ancho vive en .u-contenedor y sus modificadores.
  */
  assert.doesNotMatch(
    cssSource,
    /\.[\w-]*(?:__container|__panel|__content)[\w-]*\s*\{[^}]*(?:max-width|max-inline-size)\s*:\s*\d+px/,
  );
});

test("every page container carries its u-contenedor* class in the markup", () => {
  const esperados = [
    { file: "src/index.html", needle: 'class="about__content panel panel--spacious u-contenedor u-contenedor--contenido"' },
    { file: "src/index.html", needle: 'class="services__container u-contenedor"' },
    { file: "src/index.html", needle: 'class="contact__panel panel u-contenedor"' },
    { file: "src/index.html", needle: 'class="footer__container u-contenedor u-contenedor--medio"' },
    { file: "src/index.html", needle: 'class="footer__bottom u-contenedor u-contenedor--medio"' },
    { file: "src/app/features/portal/index.html", needle: 'class="portal__container u-contenedor u-contenedor--medio"' },
    { file: "src/app/features/courses/cursos.html", needle: 'class="courses__container u-contenedor u-contenedor--medio"' },
    { file: "src/app/features/courses/administrar-cursos.html", needle: 'class="courses__container u-contenedor u-contenedor--contenido"' },
    { file: "src/app/features/courses/editar-curso.html", needle: 'class="courses__container u-contenedor u-contenedor--contenido"' },
    { file: "src/app/features/courses/gestionar-categorias.html", needle: 'class="courses__container u-contenedor u-contenedor--contenido"' },
    { file: "src/app/features/legal/privacidad.html", needle: 'class="legal__container panel panel--spacious u-contenedor u-contenedor--lectura"' },
    { file: "src/app/features/courses/detalle-curso.html", needle: 'class="curso-detalle__container u-contenedor u-contenedor--lectura"' },
    { file: "src/index.html", needle: 'class="technology__carousels u-contenedor"' },
  ];

  for (const { file, needle } of esperados) {
    assert.ok(read(file).includes(needle), `${file} debe tener ${needle}`);
  }

  /*
    Guarda contra la trampa que causó esto: un modificador --medio/--contenido/
    --lectura SIN la clase base .u-contenedor al lado no centra nada, porque
    solo la base declara margin-inline: auto. Es el mismo patrón que
    .panel/.panel--spacious: el modificador nunca va solo.
  */
  const htmlSource = fs.readdirSync(path.join(ROOT, "src"), { recursive: true })
    .filter((file) => /\.html$/.test(file))
    .map((file) => read(path.join("src", file)))
    .join("\n");
  const clasesSinBase = htmlSource.match(/class="[^"]*\bu-contenedor--(?:medio|contenido|lectura)\b[^"]*"/g) || [];
  for (const claseAttr of clasesSinBase) {
    assert.match(claseAttr, /\bu-contenedor\b(?!-)/, `falta la clase base junto al modificador: ${claseAttr}`);
  }
});

test("the navbar aligns with the content, but scrolling never reimposes a fixed side padding", () => {
  const css = read("src/app/shared/navbar/navbar.css");

  assert.match(css, /\.navbar\s*\{[^}]*padding-inline:\s*max\(2rem,\s*calc\(\(100%\s*-\s*var\(--ancho-sitio\)\)\s*\/\s*2\)\)/);

  /*
    El shorthand `padding:` en .navbar--scrolled reimpondría un
    padding-inline fijo y rompería la alineación justo al hacer scroll, que
    es cuando el navbar tiene fondo y más se nota. Solo padding-block acá.
  */
  const scrolledRule = css.match(/\.navbar--scrolled\s*\{([^}]*)\}/);
  assert.ok(scrolledRule, ".navbar--scrolled debe existir");
  const sinComentarios = scrolledRule[1].replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(sinComentarios, /\bpadding:\s*/);
  assert.match(sinComentarios, /padding-block:\s*0\.5rem/);
});

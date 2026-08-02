const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const CURSO_PYTHON_ID = "da175f1c-cae5-45f9-889c-f09a17aa10ed";

/*
  Detalle público de un curso, genérico por `?id=`. A diferencia de la etapa
  anterior (un HTML estático por curso), acá el contenido lo pinta el JS a
  partir de un curso real, así que estas pruebas montan un DOM mínimo con
  node:vm en vez de leer texto fuente. El caso central a blindar: un campo
  sin dato en la base nunca se muestra vacío, la fila o la sección entera
  desaparece (ver el comentario al inicio de curso-detalle.js).
*/

// Nodo de texto real, no un Element: agregarTextoConNegritas (curso-presentacion.js)
// hace document.createTextNode para el texto plano alrededor de cada <strong>.
class TextNode {
  constructor(data) { this.data = data; }
  get textContent() { return this.data; }
}

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.classNames = new Set();
    this.hidden = false;
  }

  // Como en el DOM real: leer concatena el texto de todo el subárbol; asignar
  // reemplaza los hijos por un único nodo de texto. Necesario porque
  // agregarTextoConNegritas arma <strong> + texto plano como hijos, no como
  // una asignación directa a .textContent.
  get textContent() { return this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.children = [new TextNode(value)]; }

  get className() { return [...this.classNames].join(" "); }
  set className(value) { this.classNames = new Set(String(value).split(/\s+/).filter(Boolean)); }

  get classList() {
    return {
      add: (...names) => names.forEach((name) => this.classNames.add(name)),
      remove: (...names) => names.forEach((name) => this.classNames.delete(name)),
    };
  }

  append(...children) { this.children.push(...children); children.forEach((child) => { if (child instanceof Element) child.parent = this; }); }
  appendChild(child) { this.append(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  focus() { this.focused = true; }

  querySelectorAll(selector) {
    const className = selector.replace(/^\./, "");
    return this.children.filter((child) => child instanceof Element && child.classNames.has(className));
  }
}

function createDetailHarness({ search = `?id=${CURSO_PYTHON_ID}`, obtenerCursoPorId } = {}) {
  const elements = Object.fromEntries([
    "cursoEstado", "cursoEstadoMensaje", "cursoContenido", "cursoTitulo",
    "cursoObjetivosSeccion", "cursoObjetivosTexto", "cursoInfoTabla",
    "cursoTemarioSeccion", "cursoTemarioLista",
  ].map((id) => [id, new Element("div")]));
  elements.cursoEstado.hidden = true;
  elements.cursoContenido.hidden = true;
  elements.cursoObjetivosSeccion.hidden = true;
  elements.cursoTemarioSeccion.hidden = true;

  const metaTag = new Element("meta");
  const documentElement = new Element("html");
  const titles = [];

  const window = { location: { search, href: "https://taudux.test/detalle-curso.html" } };
  const document = {
    getElementById: (id) => elements[id],
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => new TextNode(text),
    querySelector: () => metaTag,
    documentElement,
    get title() { return titles[titles.length - 1]; },
    set title(value) { titles.push(value); },
  };
  const context = {
    URL, URLSearchParams, console, window, document,
    obtenerCursoPorId: obtenerCursoPorId || (async () => ({ ok: true, data: null })),
  };
  window.window = window;

  vm.runInNewContext(read("src/app/core/telemetry/operaciones.js"), context);
  vm.runInNewContext(read("src/app/core/cursos/portadas.constantes.js"), context);
  vm.runInNewContext(read("src/app/features/courses/curso-presentacion.js"), context);
  vm.runInNewContext(read("src/app/features/courses/curso-detalle.js"), context);

  return { elements, window, metaTag, titles, ready: window.tauduxCursoDetalle.ready };
}

test("a missing or malformed id shows a route error and never reveals the content shell", async () => {
  for (const search of ["", "?id=not-a-uuid", `?id=${CURSO_PYTHON_ID}&id=${CURSO_PYTHON_ID}`]) {
    const { elements, ready } = createDetailHarness({ search });
    await ready;

    assert.equal(elements.cursoEstado.hidden, false);
    assert.match(elements.cursoEstadoMensaje.textContent, /identificador del curso no es válido/);
    assert.equal(elements.cursoContenido.hidden, true);
  }
});

test("a course id that doesn't exist or isn't published is reported as not found, not as an error", async () => {
  const { elements, ready } = createDetailHarness({ obtenerCursoPorId: async () => ({ ok: true, data: null }) });
  await ready;

  assert.equal(elements.cursoEstado.hidden, false);
  assert.match(elements.cursoEstadoMensaje.textContent, /no existe o ya no está disponible/);
  assert.equal(elements.cursoContenido.hidden, true);
});

test("a load failure surfaces the service's own message", async () => {
  const { elements, ready } = createDetailHarness({
    obtenerCursoPorId: async () => ({ ok: false, mensaje: "No se pudo cargar el curso.", codigo: "course_load_failed" }),
  });
  await ready;

  assert.equal(elements.cursoEstado.hidden, false);
  assert.equal(elements.cursoEstadoMensaje.textContent, "No se pudo cargar el curso.");
});

test("a course with no optional fields at all renders only its title — every other section stays hidden, none render empty", async () => {
  const curso = { id: "11111111-1111-4111-8111-111111111111", titulo: "Curso pelado", estado: "publicado" };
  const { elements, ready } = createDetailHarness({
    search: `?id=${curso.id}`,
    obtenerCursoPorId: async () => ({ ok: true, data: curso }),
  });
  await ready;

  assert.equal(elements.cursoEstado.hidden, true);
  assert.equal(elements.cursoContenido.hidden, false);
  assert.equal(elements.cursoTitulo.textContent, "Curso pelado");
  assert.equal(elements.cursoObjetivosSeccion.hidden, true, "no hay descripcion: la sección de objetivos no se muestra vacía");
  assert.equal(elements.cursoInfoTabla.children.length, 0, "ningún campo cargado: la tabla no tiene filas");
  assert.equal(elements.cursoTemarioSeccion.hidden, true, "sin entrada en TEMARIOS_EXTRA: la sección de temario no aparece");
});

test("a fully loaded course renders every real field, formatted the same way the catalog card already does", async () => {
  const curso = {
    id: CURSO_PYTHON_ID,
    titulo: "Análisis de Datos con Python",
    categoria: "Análisis de datos",
    descripcion: "Está diseñado para formar analistas de datos competentes.",
    modalidad: "en_linea",
    fecha_inicio: "2026-08-10",
    fecha_fin: "2026-08-20",
    dias_semana: ["jue", "lun"],
    hora_inicio: "18:30:00",
    duracion_horas: 2,
    cupo_maximo: 100,
    costo: 300,
    instructor: "René Samael Flores Ortega",
    estado: "publicado",
  };
  const { elements, titles, metaTag, ready } = createDetailHarness({
    obtenerCursoPorId: async () => ({ ok: true, data: curso }),
  });
  await ready;

  assert.equal(elements.cursoContenido.hidden, false);
  assert.equal(elements.cursoTitulo.textContent, "Análisis de Datos con Python");
  assert.equal(titles[titles.length - 1], "Análisis de Datos con Python | Taudux");
  assert.equal(metaTag.attributes.content, curso.descripcion);

  const filas = Object.fromEntries(
    elements.cursoInfoTabla.children.map((fila) => [fila.children[0].textContent, fila.children[1].textContent])
  );
  assert.equal(filas["Categoría"], undefined, "la categoría se sacó a propósito de información general");
  assert.equal(filas["Modalidad"], "En línea");
  assert.equal(filas["Fechas"], "10 ago – 20 ago");
  assert.equal(filas["Horario"], "Lunes y jueves, 18:30 - 20:30", "los días se ordenan lun→dom sin importar el orden guardado en el array");
  assert.equal(filas["Duración por sesión"], "2 horas");
  assert.equal(filas["Cupo"], "100 lugares");
  assert.equal(filas["Costo"], "$300.00 MXN");
  assert.equal(filas["Instructor"], "René Samael Flores Ortega");
  assert.equal(filas["Estado"], undefined, "un curso publicado no lleva fila de estado");

  assert.equal(elements.cursoObjetivosSeccion.hidden, false);
  assert.equal(elements.cursoObjetivosTexto.children.length, 1);
  assert.equal(elements.cursoObjetivosTexto.children[0].textContent, curso.descripcion);
});

test("three or more días join with commas and a final 'y', not just the first two", async () => {
  const curso = {
    id: "66666666-6666-4666-8666-666666666666",
    titulo: "Curso de tres días por semana",
    modalidad: "presencial",
    fecha_inicio: "2026-09-01",
    fecha_fin: "2026-09-30",
    dias_semana: ["vie", "lun", "mie"],
    hora_inicio: "09:00:00",
    duracion_horas: 1,
    estado: "publicado",
  };
  const { elements, ready } = createDetailHarness({
    search: `?id=${curso.id}`,
    obtenerCursoPorId: async () => ({ ok: true, data: curso }),
  });
  await ready;

  const filas = Object.fromEntries(
    elements.cursoInfoTabla.children.map((fila) => [fila.children[0].textContent, fila.children[1].textContent])
  );
  assert.equal(filas["Horario"], "Lunes, miércoles y viernes, 09:00 - 10:00");
});

test("a course with no dias_semana at all (loaded before migration 0007) still shows a plain horario", async () => {
  const curso = {
    id: "77777777-7777-4777-8777-777777777777",
    titulo: "Curso sin días capturados",
    modalidad: "presencial",
    fecha_inicio: "2026-09-01",
    fecha_fin: "2026-09-30",
    hora_inicio: "09:00:00",
    duracion_horas: 1,
    estado: "publicado",
  };
  const { elements, ready } = createDetailHarness({
    search: `?id=${curso.id}`,
    obtenerCursoPorId: async () => ({ ok: true, data: curso }),
  });
  await ready;

  const filas = Object.fromEntries(
    elements.cursoInfoTabla.children.map((fila) => [fila.children[0].textContent, fila.children[1].textContent])
  );
  assert.equal(filas["Horario"], "09:00 - 10:00");
});

test("a multi-paragraph descripcion becomes multiple real paragraphs, not one blob", async () => {
  const curso = {
    id: "22222222-2222-4222-8222-222222222222",
    titulo: "Curso con objetivos largos",
    descripcion: "Primer párrafo.\n\nSegundo párrafo.",
    estado: "publicado",
  };
  const { elements, ready } = createDetailHarness({
    search: `?id=${curso.id}`,
    obtenerCursoPorId: async () => ({ ok: true, data: curso }),
  });
  await ready;

  assert.equal(elements.cursoObjetivosTexto.children.length, 2);
  assert.equal(elements.cursoObjetivosTexto.children[0].textContent, "Primer párrafo.");
  assert.equal(elements.cursoObjetivosTexto.children[1].textContent, "Segundo párrafo.");
});

test("**double-asterisk** text in the objetivos becomes a real <strong>, not literal asterisks", async () => {
  const curso = {
    id: "55555555-5555-4555-8555-555555555555",
    titulo: "Curso con énfasis",
    descripcion: "Este curso está diseñado para **formar analistas de datos competentes** de verdad.",
    estado: "publicado",
  };
  const { elements, ready } = createDetailHarness({
    search: `?id=${curso.id}`,
    obtenerCursoPorId: async () => ({ ok: true, data: curso }),
  });
  await ready;

  const parrafo = elements.cursoObjetivosTexto.children[0];
  assert.equal(parrafo.textContent, "Este curso está diseñado para formar analistas de datos competentes de verdad.");

  const negrita = parrafo.children.find((child) => child.tagName === "STRONG");
  assert.ok(negrita, "debe existir un <strong> real, no el texto con los asteriscos literales");
  assert.equal(negrita.textContent, "formar analistas de datos competentes");
  assert.equal(parrafo.children.filter((child) => child.tagName === "STRONG").length, 1);
});

test("a course only an admin can reach (RLS lets it through unpublished) discloses its own draft/archived state", async () => {
  const curso = { id: "33333333-3333-4333-8333-333333333333", titulo: "Borrador visible solo a admin", estado: "borrador" };
  const { elements, ready } = createDetailHarness({
    search: `?id=${curso.id}`,
    obtenerCursoPorId: async () => ({ ok: true, data: curso }),
  });
  await ready;

  const filas = Object.fromEntries(
    elements.cursoInfoTabla.children.map((fila) => [fila.children[0].textContent, fila.children[1].textContent])
  );
  assert.equal(filas["Estado"], "Borrador (solo visible para administradores)");
});

test("the syllabus comes from the course row and reveals itself without a real IntersectionObserver", async () => {
  const curso = {
    id: CURSO_PYTHON_ID,
    titulo: "Análisis de Datos con Python",
    estado: "publicado",
    temario: [
      { titulo: "Estructuras de Pandas", subtitulo: "Fundamentos.", temas: ["Series", "DataFrame"] },
      { titulo: "Estadística descriptiva", subtitulo: "Resumir con rigor.", temas: ["Media", "Mediana"] },
    ],
  };
  const { elements, ready } = createDetailHarness({ obtenerCursoPorId: async () => ({ ok: true, data: curso }) });
  await ready;

  assert.equal(elements.cursoTemarioSeccion.hidden, false);
  assert.equal(elements.cursoTemarioLista.children.length, 2);
  assert.match(elements.cursoTemarioLista.children[0].textContent, /Estructuras de Pandas/);
  elements.cursoTemarioLista.children.forEach((modulo) => {
    assert.ok(modulo.classNames.has("is-visible"), "sin IntersectionObserver en el harness, el fallback debe revelar todo");
  });
});

test("a course with no temario loaded never shows a syllabus section, even with everything else filled in", async () => {
  const curso = {
    id: "44444444-4444-4444-8444-444444444444",
    titulo: "Curso sin temario cargado todavía",
    descripcion: "Algo",
    modalidad: "presencial",
    costo: 0,
    estado: "publicado",
  };
  const { elements, ready } = createDetailHarness({
    search: `?id=${curso.id}`,
    obtenerCursoPorId: async () => ({ ok: true, data: curso }),
  });
  await ready;

  assert.equal(elements.cursoTemarioSeccion.hidden, true);
  assert.equal(elements.cursoTemarioLista.children.length, 0);
});

/*
  La columna es jsonb y el CHECK de 0020 solo garantiza que sea un arreglo: la
  forma interna puede ser cualquier cosa. Estos dos casos son los que hacían
  explotar el render antes de blindarlo.
*/
test("a malformed temario degrades to no section instead of throwing", async () => {
  for (const temario of ["no soy un arreglo", 42, [null], [{ subtitulo: "sin título" }], []]) {
    const curso = {
      id: "88888888-8888-4888-8888-888888888888",
      titulo: "Curso con temario roto",
      estado: "publicado",
      temario,
    };
    const { elements, ready } = createDetailHarness({
      search: `?id=${curso.id}`,
      obtenerCursoPorId: async () => ({ ok: true, data: curso }),
    });
    await ready;

    assert.equal(elements.cursoTemarioSeccion.hidden, true, `temario: ${JSON.stringify(temario)}`);
    assert.equal(elements.cursoContenido.hidden, false, "el resto de la página sigue viéndose");
  }
});

test("a module whose temas is missing or not an array still renders its title", async () => {
  const curso = {
    id: "99999999-9999-4999-8999-999999999999",
    titulo: "Curso con módulo sin temas",
    estado: "publicado",
    temario: [{ titulo: "Módulo pelado" }, { titulo: "Módulo con basura", temas: "no soy arreglo" }],
  };
  const { elements, ready } = createDetailHarness({
    search: `?id=${curso.id}`,
    obtenerCursoPorId: async () => ({ ok: true, data: curso }),
  });
  await ready;

  assert.equal(elements.cursoTemarioSeccion.hidden, false);
  assert.equal(elements.cursoTemarioLista.children.length, 2);
  assert.match(elements.cursoTemarioLista.children[0].textContent, /Módulo pelado/);
});

test("the four content fields from migration 0020 each render as their own row, and vanish when empty", async () => {
  const curso = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    titulo: "Curso con contexto completo",
    estado: "publicado",
    numero_sesiones: 4,
    dirigido_a: "Principiantes",
    requisitos: "Ninguno",
    herramientas: "Python y Pandas",
  };
  const { elements, ready } = createDetailHarness({
    search: `?id=${curso.id}`,
    obtenerCursoPorId: async () => ({ ok: true, data: curso }),
  });
  await ready;

  const filas = Object.fromEntries(
    elements.cursoInfoTabla.children.map((fila) => [fila.children[0].textContent, fila.children[1].textContent])
  );
  assert.equal(filas["Sesiones"], "4 sesiones");
  assert.equal(filas["Dirigido a"], "Principiantes");
  assert.equal(filas["Requisitos previos"], "Ninguno");
  assert.equal(filas["Herramientas"], "Python y Pandas");
  assert.equal(filas["Cupo"], undefined, "sin cupo cargado, la fila no aparece vacía");
});

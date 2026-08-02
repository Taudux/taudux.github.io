/*
  Detalle público de un curso, genérico por `?id=<uuid>`: aplica a cualquier
  curso, presente o futuro, sin tocar este archivo. RLS de 0014 sigue siendo el
  gate real (`obtenerCursoPorId` no filtra por estado); un curso no publicado
  llega como `data: null`, indistinguible de uno inexistente.

  Las secciones sin columna propia en `cursos` (temario, dirigido a, requisitos,
  herramientas) no se inventan ni se muestran vacías: si el curso no tiene
  entrada en TEMARIOS_EXTRA, la sección completa queda oculta. Se borra esta
  constante cuando ese contenido pase a vivir en la base.

  Depende de auth.service.js (navbar), telemetry/operaciones.js,
  portadas.constantes.js, cursos.service.js y curso-presentacion.js.
*/

const TEMARIOS_EXTRA = {
  "da175f1c-cae5-45f9-889c-f09a17aa10ed": {
    modulos: [
      {
        titulo: "Estructuras de Pandas e importación de datos",
        subtitulo: "Fundamentos de la manipulación de datos tabulares en Python.",
        temas: [
          "Objetos Series y DataFrame",
          "Objetos Index (índices)",
          "Reindexación y eliminación de entradas",
          "Indexado, selección y filtrado",
          "Aritmética y alineación de datos",
          "Ordenamiento y ranking",
          "Índices con valores duplicados",
          "Importación de datos desde archivos",
        ],
      },
      {
        titulo: "Estadística descriptiva",
        subtitulo: "Cómo resumir y comprender un conjunto de datos con rigor.",
        temas: [
          "Tipos de datos (nominal, ordinal, discreto, continuo)",
          "Tendencia central: media, mediana y moda",
          "Asimetría y coeficiente de asimetría de Pearson",
          "Variabilidad: varianza, desviación estándar, rango e IQR",
          "Coeficiente de variación",
          "Cuartiles, percentiles y deciles",
          "Tablas de frecuencia",
          "Correlación y covarianza",
        ],
      },
      {
        titulo: "Preparación y limpieza de datos",
        subtitulo: "De datos crudos y desordenados a datos listos para analizar.",
        temas: [
          "Detección y filtrado de datos faltantes",
          "Imputación de valores (media, mediana y moda)",
          "Eliminación de duplicados",
          "Transformación con funciones y mapeo",
          "Reemplazo de valores y renombrado de ejes",
          "Discretización y binning",
          "Detección y filtrado de outliers",
          "Permutación y muestreo aleatorio",
          "Creación de variables dummy",
        ],
      },
      {
        titulo: "Visualización con Matplotlib y Seaborn",
        subtitulo: "Comunicar hallazgos con el gráfico correcto para cada tipo de dato.",
        temas: [
          "Qué graficar según el tipo de variable",
          "Histogramas y curvas de densidad",
          "Barras y conteo de categorías",
          "Diagrama de caja y bigotes (boxplot)",
          "Diagrama de violín",
          "Diagrama de dispersión",
          "Distribución acumulada (ECDF)",
          "Mapa de calor de correlaciones",
          "Caso integrador de práctica",
        ],
      },
    ],
  },
};

async function iniciarCursoDetalle() {
  document.documentElement.classList.remove("no-js");

  const { iniciarTiempo, reportarFallo } = crearReporteroOperaciones("course_detail");
  const estado = document.getElementById("cursoEstado");
  const mensajeEstado = document.getElementById("cursoEstadoMensaje");

  function mostrarError(mensaje) {
    estado.hidden = false;
    mensajeEstado.textContent = mensaje;
    estado.focus();
  }

  // Un curso puede tener cualquier UUID v1-v8; comparte forma con el token de
  // portada, que también lo emite el servidor (mismo criterio que
  // gestionar-curso.js). getAll, no get: un `?id=` repetido es un error de
  // ruta explícito, nunca una ambigüedad silenciosa.
  const UUID_CURSO = UUID_TOKEN_PORTADA;
  const ids = new URLSearchParams(window.location.search).getAll("id");
  if (ids.length !== 1 || !UUID_CURSO.test(ids[0])) {
    mostrarError("El identificador del curso no es válido. Vuelve al catálogo e inténtalo de nuevo.");
    return;
  }

  const inicio = iniciarTiempo();
  let resultado;
  try {
    resultado = await obtenerCursoPorId(ids[0]);
  } catch (error) {
    reportarFallo("course_detail_load", error, inicio, "detail_load_exception");
    mostrarError("No se pudo cargar el curso. Revisa tu conexión y vuelve a intentarlo.");
    return;
  }
  if (!resultado.ok) {
    reportarFallo("course_detail_load", null, inicio, resultado.codigo || "detail_load_failed");
    mostrarError(resultado.mensaje || "No se pudo cargar el curso.");
    return;
  }
  if (!resultado.data) {
    mostrarError("Este curso no existe o ya no está disponible.");
    return;
  }

  pintarCurso(resultado.data);
}

function pintarCurso(curso) {
  document.title = `${curso.titulo} | Taudux`;
  const metaDescripcion = document.querySelector('meta[name="description"]');
  if (metaDescripcion && curso.descripcion) {
    metaDescripcion.setAttribute("content", curso.descripcion);
  }

  document.getElementById("cursoTitulo").textContent = curso.titulo;

  pintarObjetivos(curso.descripcion);
  pintarInfoGeneral(curso);
  pintarTemario(curso);

  document.getElementById("cursoContenido").hidden = false;
}

function pintarObjetivos(descripcion) {
  if (!descripcion) return;

  const seccion = document.getElementById("cursoObjetivosSeccion");
  const contenedor = document.getElementById("cursoObjetivosTexto");
  descripcion
    .split(/\n{2,}/)
    .map((parrafo) => parrafo.trim())
    .filter(Boolean)
    .forEach((parrafo) => {
      const p = document.createElement("p");
      agregarTextoConNegritas(p, parrafo);
      contenedor.appendChild(p);
    });
  seccion.hidden = false;
}

function pintarInfoGeneral(curso) {
  const tabla = document.getElementById("cursoInfoTabla");

  agregarFilaInfo(tabla, "Modalidad", etiquetaModalidad(curso));

  if (curso.proximamente) {
    agregarFilaInfo(tabla, "Fechas", "Próximamente — escríbenos para conocerlas");
  } else {
    agregarFilaInfo(tabla, "Fechas", formatearRangoFechas(curso));
    agregarFilaInfo(tabla, "Horario", combinarDiasYHorario(curso));
  }

  agregarFilaInfo(tabla, "Duración por sesión", curso.duracion_horas ? `${curso.duracion_horas} horas` : null);
  agregarFilaInfo(tabla, "Cupo", curso.cupo_maximo ? `${curso.cupo_maximo} lugares` : null);
  agregarFilaInfo(tabla, "Costo", formatearCosto(curso.costo));
  agregarFilaInfo(tabla, "Instructor", curso.instructor);

  // Solo un admin puede llegar hasta acá con un curso no publicado (RLS de
  // 0014); si ocurre, conviene que lo sepa de un vistazo, igual que en cursos.js.
  if (curso.estado && curso.estado !== "publicado") {
    agregarFilaInfo(
      tabla,
      "Estado",
      curso.estado === "borrador"
        ? "Borrador (solo visible para administradores)"
        : "Archivado (solo visible para administradores)"
    );
  }
}

// "Lunes y jueves, 18:30 - 20:30", o solo el horario si no hay días
// capturados (cursos viejos, cargados antes de la migración 0007).
function combinarDiasYHorario(curso) {
  const horario = formatearHorario(curso);
  const dias = formatearDiasSemana(curso);
  if (dias && horario) return `${dias}, ${horario}`;
  return horario;
}

function agregarFilaInfo(tabla, etiqueta, valor) {
  if (!valor) return;

  const fila = document.createElement("div");
  fila.className = "curso-detalle__info-row";

  const dt = document.createElement("dt");
  dt.textContent = etiqueta;

  const dd = document.createElement("dd");
  dd.textContent = valor;

  fila.append(dt, dd);
  tabla.appendChild(fila);
}

function pintarTemario(curso) {
  const extra = TEMARIOS_EXTRA[curso.id];
  if (!extra) return;

  const seccion = document.getElementById("cursoTemarioSeccion");
  const lista = document.getElementById("cursoTemarioLista");
  extra.modulos.forEach((modulo, indice) => {
    lista.appendChild(crearModuloTemario(modulo, indice + 1));
  });
  seccion.hidden = false;

  iniciarRevelado(lista.querySelectorAll(".curso-detalle__modulo"));
}

function crearModuloTemario(modulo, numero) {
  const articulo = document.createElement("article");
  articulo.className = "curso-detalle__modulo panel";

  const badge = document.createElement("span");
  badge.className = "curso-detalle__modulo-badge";
  badge.textContent = String(numero).padStart(2, "0");

  const titulo = document.createElement("h3");
  titulo.className = "curso-detalle__modulo-title";
  titulo.textContent = modulo.titulo;

  const subtitulo = document.createElement("p");
  subtitulo.className = "curso-detalle__modulo-subtitle";
  subtitulo.textContent = modulo.subtitulo;

  const temas = document.createElement("ul");
  temas.className = "curso-detalle__modulo-topics";
  modulo.temas.forEach((tema) => {
    const item = document.createElement("li");
    item.textContent = tema;
    temas.appendChild(item);
  });

  articulo.append(badge, titulo, subtitulo, temas);
  return articulo;
}

// Mejora progresiva pura: sin JS o sin soporte, `.no-js` deja los módulos
// visibles desde el arranque (ver curso-detalle.css).
function iniciarRevelado(modulos) {
  if (!("IntersectionObserver" in window)) {
    modulos.forEach((modulo) => modulo.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entradas) => {
      entradas.forEach((entrada) => {
        if (entrada.isIntersecting) {
          entrada.target.classList.add("is-visible");
          observer.unobserve(entrada.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  modulos.forEach((modulo) => observer.observe(modulo));
}

window.tauduxCursoDetalle = {
  iniciar: iniciarCursoDetalle,
};
window.tauduxCursoDetalle.ready = window.tauduxCursoDetalle.iniciar();
Object.freeze(window.tauduxCursoDetalle);

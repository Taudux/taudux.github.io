/*
  Catálogo público de cursos con controles de administración revelados solo al rol
  admin. RLS sigue siendo el gate real para las escrituras. Depende de auth.service.js,
  cursos.service.js, telemetry/operaciones.js y toast.js.
*/

async function iniciarCatalogoCursos() {
  const { iniciarTiempo, reportarFallo } = crearReporteroOperaciones("course_catalog");
  const lista = document.getElementById("cursosLista");
  const controlesAdmin = document.getElementById("adminControls");
  const estado = document.getElementById("cursosEstado");
  const mensajeEstado = document.getElementById("cursosEstadoMensaje");
  const botonReintentar = document.getElementById("cursosReintentar");
  let usuarioAdmin = false;

  botonReintentar.addEventListener("click", async () => {
    const cargados = await pintarCursos();
    (cargados ? lista : estado).focus();
  });

  const inicioAdminCheck = iniciarTiempo();
  try {
    const session = await obtenerSesion();
    usuarioAdmin = Boolean(session && await esAdmin(session));
  } catch (error) {
    reportarFallo("catalog_admin_check", error, inicioAdminCheck, "admin_check_failed");
  }
  controlesAdmin.hidden = !usuarioAdmin;
  await pintarCursos();
  mostrarResultadoGuardado();

  async function pintarCursos() {
    const inicio = iniciarTiempo();
    lista.setAttribute("aria-busy", "true");
    botonReintentar.disabled = true;
    let resultado;
    try {
      resultado = await listarCursos();
    } catch (error) {
      reportarFallo("course_list_load", error, inicio, "list_exception");
      mostrarErrorLista("No se pudieron cargar los cursos. Reintenta cuando tengas conexión.");
      return false;
    } finally {
      lista.setAttribute("aria-busy", "false");
      botonReintentar.disabled = false;
    }

    if (!resultado.ok) {
      reportarFallo("course_list_load", null, inicio, resultado.codigo || "list_failed");
      mostrarErrorLista(resultado.mensaje || "No se pudieron cargar los cursos.");
      return false;
    }

    estado.hidden = true;
    mensajeEstado.textContent = "";
    lista.replaceChildren();
    if (resultado.data.length === 0) {
      lista.appendChild(crearEstadoVacio());
      return true;
    }
    resultado.data.forEach((curso) => {
      lista.appendChild(crearTarjetaCurso(curso));
    });
    return true;
  }

  function mostrarErrorLista(mensaje) {
    estado.hidden = false;
    estado.classList.add("courses__data-status--error");
    mensajeEstado.textContent = mensaje;
  }

  function mostrarResultadoGuardado() {
    const url = new URL(window.location.href);
    const resultado = url.searchParams.get("resultado");
    if (resultado === "creado") mostrarToast("Curso publicado.", "success");
    if (resultado === "actualizado") mostrarToast("Curso actualizado.", "success");
    if (resultado === "creado_borrador" || resultado === "actualizado_borrador") {
      mostrarToast("Curso guardado como borrador.", "success");
    }
    if (!resultado) return;
    url.searchParams.delete("resultado");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

}

function crearEstadoVacio() {
  const vacio = document.createElement("p");
  vacio.className = "courses__empty";
  vacio.textContent = "Aún no hay cursos publicados.";
  return vacio;
}

// Tarjeta pública de solo lectura y activable: imagen, título, descripción,
// información de modalidad/fechas/horario y chips de cupo/costo/estado.
// Fechas y horario se omiten si el curso es "próximamente". Editar/eliminar
// viven en administrar-cursos.html, no en el catálogo.
function crearTarjetaCurso(curso) {
  const tarjeta = document.createElement("article");
  tarjeta.className = "courses__card courses__card--catalog panel";

  const media = document.createElement("div");
  media.className = "courses__card-media";

  if (curso.imagen_url && esUrlSegura(curso.imagen_url)) {
    const img = document.createElement("img");
    img.className = "courses__card-image";
    img.src = curso.imagen_url;
    img.alt = curso.titulo ? `Portada del curso ${curso.titulo}` : "Portada del curso";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => crearFallbackCurso(media, curso), { once: true });
    media.appendChild(img);
  } else {
    crearFallbackCurso(media, curso);
  }

  tarjeta.appendChild(media);

  const cuerpo = document.createElement("div");
  cuerpo.className = "courses__card-body";

  const titulo = document.createElement("h2");
  titulo.className = "courses__card-title";
  titulo.textContent = curso.titulo;
  cuerpo.appendChild(titulo);

  if (curso.descripcion) {
    const desc = document.createElement("p");
    desc.className = "courses__card-description";
    desc.textContent = curso.descripcion;
    cuerpo.appendChild(desc);
  }

  const informacion = document.createElement("div");
  informacion.className = "courses__card-info";

  agregarInformacionCurso(
    informacion,
    "modalidad",
    "Modalidad",
    etiquetaModalidad(curso)
  );

  if (!curso.proximamente) {
    const rango = formatearRangoFechas(curso);
    agregarInformacionCurso(informacion, "fechas", "Fechas", rango);

    const horario = formatearHorario(curso);
    agregarInformacionCurso(informacion, "horario", "Horario", horario);
  }

  if (informacion.childElementCount) {
    cuerpo.appendChild(informacion);
  }

  const chips = document.createElement("div");
  chips.className = "courses__card-chips";

  agregarChipCurso(
    chips,
    curso.cupo_maximo ? `Cupo: ${curso.cupo_maximo} lugares` : null
  );
  agregarChipCurso(chips, formatearCosto(curso.costo));
  if (curso.proximamente) {
    agregarChipCurso(chips, "Próximamente", "proximamente");
  }
  // Un usuario normal nunca recibe estas filas (RLS de 0014); si aparece es
  // porque quien mira el catálogo es admin, y conviene que lo sepa de un vistazo.
  if (curso.estado && curso.estado !== "publicado") {
    agregarChipCurso(chips, curso.estado === "borrador" ? "Borrador" : "Archivado", "estado");
  }

  if (chips.childElementCount) {
    cuerpo.appendChild(chips);
  }

  tarjeta.appendChild(cuerpo);

  const activador = document.createElement("button");
  activador.className = "courses__card-hit-area";
  activador.type = "button";
  activador.setAttribute(
    "aria-label",
    `Ver detalles del curso: ${curso.titulo || "curso sin título"}`
  );
  activador.addEventListener("click", () => irADetalleDeCurso(curso.id));
  tarjeta.appendChild(activador);

  return tarjeta;
}

function agregarInformacionCurso(contenedor, tipo, etiqueta, valor) {
  if (!valor) return;

  const item = document.createElement("p");
  item.className = `courses__card-info-row courses__card-info-row--${tipo}`;

  const label = document.createElement("span");
  label.className = "courses__card-info-label";
  label.textContent = `${etiqueta}: `;

  const value = document.createElement("strong");
  value.className = "courses__card-info-value";
  value.textContent = valor;

  const texto = document.createElement("span");
  texto.className = "courses__card-info-text";
  texto.append(label, value);

  item.appendChild(texto);
  contenedor.appendChild(item);
}

function agregarChipCurso(contenedor, texto, modificador = null) {
  if (!texto) return;

  const chip = document.createElement("span");
  chip.className = "courses__card-chip";
  if (modificador) {
    chip.classList.add(`courses__card-chip--${modificador}`);
  }
  chip.textContent = texto;
  contenedor.appendChild(chip);
}

function crearFallbackCurso(media, curso) {
  media.replaceChildren();
  media.classList.add("courses__card-media--fallback");
  media.setAttribute("aria-hidden", "true");

  const mediaLabel = document.createElement("span");
  mediaLabel.className = "courses__card-media-label";
  mediaLabel.textContent = "TAUDUX / ACADEMY";

  const mediaTopic = document.createElement("span");
  mediaTopic.className = "courses__card-media-topic";
  mediaTopic.textContent = (curso.categoria || "Formación tecnológica").toUpperCase();

  media.append(mediaLabel, mediaTopic);
}

function irADetalleDeCurso(cursoId) {
  window.location.href = `/app/features/courses/detalle-curso.html?id=${encodeURIComponent(cursoId)}`;
}

window.tauduxCursosCatalog = {
  iniciar: iniciarCatalogoCursos,
};
window.tauduxCursosCatalog.ready = window.tauduxCursosCatalog.iniciar();
Object.freeze(window.tauduxCursosCatalog);

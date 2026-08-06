/*
  Vista de cuadrícula del panel de administración de cursos. Requiere sesión y
  rol admin (admin-startup.js); RLS sigue siendo el gate real para escrituras.

  Título y categoría vienen de cursos.service.js (Supabase real, vía listarCursos()).
  El sello "Actualizado" sigue siendo placeholder: la tabla `cursos` tiene una
  columna real (`actualizado_en`), pero CAMPOS_CURSO_BASE todavía no la selecciona.
  Cuando la exponga, se reemplaza FECHAS_ACTUALIZACION_PLACEHOLDER por el campo real.

  Eliminar borra la fila de verdad, previa confirmación por tipeo del título
  (confirm-dialog.js). La portada no se toca desde acá: el trigger
  cursos_enqueue_cover_cleanup la encola al borrar la fila.
*/

const FECHAS_ACTUALIZACION_PLACEHOLDER = ["10 jul 2026", "22 jul 2026", "24 jul 2026"];

function crearEstadoVacioAdmin(mensaje) {
  const vacio = document.createElement("p");
  vacio.className = "courses__empty";
  vacio.textContent = mensaje;
  return vacio;
}

// Único botón cuya acción y etiqueta dependen del estado actual: publicado
// se archiva, borrador o archivado se publica. No hay tercer botón para pasar
// a borrador desde acá; eso vive en el formulario (Guardar borrador).
function accionEstadoCurso(curso) {
  return curso.estado === "publicado"
    ? { estadoDestino: "archivado", etiqueta: "Archivar" }
    : { estadoDestino: "publicado", etiqueta: "Publicar" };
}

/*
  El toggle llega directo a actualizarEstadoCurso, sin pasar por el formulario
  ni su validación: sin este chequeo, un borrador guardado con formnovalidate
  (que puede no tener días de la semana) se publicaría incompleto con un solo
  click. Espeja la regla de gestionar-curso.js#enviarFormulario.
*/
function cursoListoParaPublicar(curso, estadoDestino) {
  if (estadoDestino !== "publicado") return true;
  if (curso.proximamente) return true;
  return Array.isArray(curso.dias_semana) && curso.dias_semana.length > 0;
}

// Migración 0018: publicar siempre reencola el aviso, incluso si el curso ya
// fue anunciado antes. Migración 0026: ese aviso ahora es solo push, nunca
// correo. Estos son los tres textos posibles del diálogo de confirmación
// simple que antecede a ese envío masivo.
const TEXTO_AVISO_NUEVO =
  "Se enviará una notificación push a todos los usuarios suscritos que tengan la app instalada.";
const TEXTO_AVISO_REENVIO =
  "Este curso ya fue anunciado antes. Al publicarlo se volverá a enviar la notificación push a todos los suscritos, incluidos los que ya la recibieron.";
const TEXTO_AVISO_DESCONOCIDO =
  "No pudimos verificar si este curso ya fue anunciado. Al publicarlo se enviará una notificación push a todos los usuarios suscritos.";

/*
  No bloquea ni publica en silencio si la consulta falla: usa el texto
  conservador y deja que decida el admin. `yaAnunciado` es cursoYaAnunciado
  del servicio, inyectada para poder testear sin Supabase real.
*/
async function mensajeConfirmacionPublicar(cursoId, yaAnunciado) {
  let resultado;
  try {
    resultado = await yaAnunciado(cursoId);
  } catch {
    resultado = { ok: false };
  }
  if (!resultado || !resultado.ok) return TEXTO_AVISO_DESCONOCIDO;
  return resultado.data ? TEXTO_AVISO_REENVIO : TEXTO_AVISO_NUEVO;
}

function crearAdministradorCursos({
  lista,
  listar,
  eliminar,
  cambiarEstado,
  confirmar,
  yaAnunciado,
  notificar,
  reportarFallo,
  iniciarTiempo,
  enfocar,
}) {
  let mutacionEnCurso = false;
  let cargaEnCurso = false;
  let cursosVisibles = [];

  function actualizarDisponibilidad() {
    const ocupado = mutacionEnCurso || cargaEnCurso;
    lista.setAttribute("aria-busy", String(ocupado));
    lista.classList.toggle("courses__list--ocupada", ocupado);

    // Un <a> no acepta disabled, así que Editar se inertiza por aria-disabled.
    cursosVisibles.forEach((curso) => {
      const botonEliminar = document.getElementById(`curso-eliminar-${curso.id}`);
      if (botonEliminar) botonEliminar.disabled = ocupado;
      const botonEstado = document.getElementById(`curso-estado-${curso.id}`);
      if (botonEstado) botonEstado.disabled = ocupado;
      const enlaceEditar = document.getElementById(`curso-editar-${curso.id}`);
      if (enlaceEditar) enlaceEditar.setAttribute("aria-disabled", String(ocupado));
    });
  }

  function iniciarMutacion() {
    if (mutacionEnCurso || cargaEnCurso) return false;
    mutacionEnCurso = true;
    actualizarDisponibilidad();
    return true;
  }

  function finalizarMutacion(focoId) {
    mutacionEnCurso = false;
    actualizarDisponibilidad();
    enfocar(focoId);
  }

  /*
    El foco no puede quedarse en un botón que está por desaparecer: apunta al
    curso siguiente, o al anterior si el borrado era el último, o al alta.
  */
  function idSiguienteFoco(idBorrado) {
    const indice = cursosVisibles.findIndex((curso) => curso.id === idBorrado);
    const vecino = cursosVisibles[indice + 1] || cursosVisibles[indice - 1];
    return vecino ? `curso-eliminar-${vecino.id}` : "cursoNuevo";
  }

  async function confirmarEliminacion(curso, boton) {
    // showModal() inertiza el resto del documento, así que basta con no abrir un
    // segundo diálogo sobre una operación ya en vuelo.
    if (mutacionEnCurso || cargaEnCurso) return;

    const confirmado = await confirmar({
      titulo: "Eliminar curso",
      mensaje: `Se eliminará "${curso.titulo}" de forma definitiva, junto con su portada. Esta acción no se puede deshacer.`,
      textoEsperado: curso.titulo,
      etiquetaConfirmar: "Eliminar curso",
    });
    if (!confirmado || !iniciarMutacion()) return;

    const inicio = iniciarTiempo();
    let focoId = boton.id;
    try {
      const resultado = await eliminar(curso.id);
      if (!resultado.ok) {
        reportarFallo("course_delete", null, inicio, resultado.codigo || "course_delete_failed");
        notificar(resultado.mensaje, "error");
        return;
      }

      notificar(
        resultado.yaNoExistia
          ? "El curso ya no existía. Se actualizó la lista."
          : "Curso eliminado.",
        "success"
      );
      focoId = idSiguienteFoco(curso.id);

      try {
        await cargarCursos();
      } catch (error) {
        /*
          El borrado sí ocurrió: dejar la tarjeta en pantalla mostraría un curso
          que ya no existe, así que se quita aunque no hayamos podido refrescar.
        */
        reportarFallo("course_delete", error, inicio, "course_delete_reload_failed");
        lista.querySelector(`[data-curso-id="${curso.id}"]`)?.remove();
        cursosVisibles = cursosVisibles.filter((visible) => visible.id !== curso.id);
        notificar("El curso se eliminó, pero no se pudo actualizar la lista. Recarga la página.", "error");
      }
    } catch (error) {
      reportarFallo("course_delete", error, inicio, "course_delete_exception");
      notificar("No se pudo eliminar el curso. Revisa tu conexión e inténtalo de nuevo.", "error");
    } finally {
      finalizarMutacion(focoId);
    }
  }

  /*
    Archivar es reversible y no manda nada, así que —a diferencia de eliminar—
    no pasa por ningún diálogo: solo el candado de mutación en vuelo y el
    toast de resultado. Publicar sí abre el diálogo simple de confirm-dialog.js
    (sin tipeo) porque, desde la 0018, publicar siempre reencola el aviso
    (solo push desde la 0026) aunque el curso ya haya sido anunciado antes;
    el candado se toma recién después de que el admin confirme, para que
    cancelar no deje la lista trabada. La tarjeta no desaparece, así que el
    foco vuelve al mismo
    botón tras refrescar.
  */
  async function confirmarCambioEstado(curso, boton) {
    if (mutacionEnCurso || cargaEnCurso) return;

    const { estadoDestino } = accionEstadoCurso(curso);
    if (!cursoListoParaPublicar(curso, estadoDestino)) {
      notificar(
        "Este curso no tiene días de la semana asignados. Edítalo para completar los datos antes de publicarlo.",
        "error"
      );
      return;
    }

    if (estadoDestino === "publicado") {
      const mensaje = await mensajeConfirmacionPublicar(curso.id, yaAnunciado);
      const confirmado = await confirmar({
        titulo: "Publicar curso",
        mensaje,
        etiquetaConfirmar: "Publicar",
      });
      if (!confirmado) return;
    }

    if (!iniciarMutacion()) return;

    const inicio = iniciarTiempo();
    try {
      const resultado = await cambiarEstado(curso.id, estadoDestino);
      if (!resultado.ok) {
        reportarFallo("course_state_change", null, inicio, resultado.codigo || "course_state_change_failed");
        notificar(resultado.mensaje, "error");
        return;
      }

      notificar(
        estadoDestino === "publicado" ? "Curso publicado." : "Curso archivado.",
        "success"
      );

      try {
        await cargarCursos();
      } catch (error) {
        reportarFallo("course_state_change", error, inicio, "course_state_change_reload_failed");
        notificar("El estado se actualizó, pero no se pudo refrescar la lista. Recarga la página.", "error");
      }
    } catch (error) {
      reportarFallo("course_state_change", error, inicio, "course_state_change_exception");
      notificar("No se pudo actualizar el estado del curso. Revisa tu conexión e inténtalo de nuevo.", "error");
    } finally {
      finalizarMutacion(boton.id);
    }
  }

  function crearTarjetaCursoAdmin(curso, indice) {
    const tarjeta = document.createElement("article");
    tarjeta.className = "courses__card panel";
    tarjeta.dataset.cursoId = curso.id;

    const media = document.createElement("div");
    media.className = "courses__card-media courses__card-media--fallback";
    media.setAttribute("aria-hidden", "true");

    // Un solo contenedor posicionado; los sellos se apilan por flujo normal
    // (flex column) en vez de cada uno con su propio position:absolute, así
    // no se solapan ni se aprietan entre sí en una tarjeta angosta.
    const badges = document.createElement("div");
    badges.className = "courses__card-badges";

    const badge = document.createElement("span");
    badge.className = "courses__card-updated-badge";
    const fechaPlaceholder = FECHAS_ACTUALIZACION_PLACEHOLDER[
      indice % FECHAS_ACTUALIZACION_PLACEHOLDER.length
    ];
    badge.textContent = `Actualizado: ${fechaPlaceholder}`;
    badges.appendChild(badge);

    // Publicado es el estado esperado y no necesita sello; borrador/archivado
    // sí, porque son los que un usuario normal nunca llega a ver (RLS de 0014).
    if (curso.estado && curso.estado !== "publicado") {
      const estadoBadge = document.createElement("span");
      estadoBadge.className = "courses__card-state-badge";
      estadoBadge.textContent = curso.estado === "borrador" ? "Borrador" : "Archivado";
      badges.appendChild(estadoBadge);
    }

    media.appendChild(badges);

    const mediaLabel = document.createElement("span");
    mediaLabel.className = "courses__card-media-label";
    mediaLabel.textContent = "TAUDUX / ACADEMY";

    const mediaTopic = document.createElement("span");
    mediaTopic.className = "courses__card-media-topic";
    mediaTopic.textContent = (curso.categoria || "Formación tecnológica").toUpperCase();

    media.append(mediaLabel, mediaTopic);
    tarjeta.appendChild(media);

    const cuerpo = document.createElement("div");
    cuerpo.className = "courses__card-body";

    const titulo = document.createElement("h2");
    titulo.className = "courses__card-title";
    titulo.textContent = curso.titulo;
    cuerpo.appendChild(titulo);

    const acciones = document.createElement("div");
    acciones.className = "courses__card-admin";

    const editar = document.createElement("a");
    editar.className = "button courses__action";
    editar.id = `curso-editar-${curso.id}`;
    editar.href = `/app/features/courses/editar-curso.html?id=${encodeURIComponent(curso.id)}`;
    editar.textContent = "Editar";
    editar.setAttribute("aria-label", `Editar curso ${curso.titulo}`);

    const { etiqueta: etiquetaEstado } = accionEstadoCurso(curso);
    const cambiarEstadoBoton = document.createElement("button");
    cambiarEstadoBoton.className = "button courses__action";
    cambiarEstadoBoton.id = `curso-estado-${curso.id}`;
    cambiarEstadoBoton.type = "button";
    cambiarEstadoBoton.textContent = etiquetaEstado;
    cambiarEstadoBoton.setAttribute("aria-label", `${etiquetaEstado} curso ${curso.titulo}`);
    cambiarEstadoBoton.addEventListener("click", () => confirmarCambioEstado(curso, cambiarEstadoBoton));

    const eliminar = document.createElement("button");
    eliminar.className = "button courses__action courses__action--danger";
    eliminar.id = `curso-eliminar-${curso.id}`;
    eliminar.type = "button";
    eliminar.textContent = "Eliminar";
    eliminar.setAttribute("aria-label", `Eliminar curso ${curso.titulo}`);
    eliminar.addEventListener("click", () => confirmarEliminacion(curso, eliminar));

    acciones.append(editar, cambiarEstadoBoton, eliminar);
    cuerpo.appendChild(acciones);
    tarjeta.appendChild(cuerpo);

    return tarjeta;
  }

  function pintarCursos(cursos) {
    cursosVisibles = cursos;
    lista.replaceChildren(
      ...(cursos.length === 0
        ? [crearEstadoVacioAdmin("Aún no hay cursos publicados.")]
        : cursos.map((curso, indice) => crearTarjetaCursoAdmin(curso, indice)))
    );
  }

  async function cargarCursos() {
    cargaEnCurso = true;
    actualizarDisponibilidad();
    try {
      const resultado = await listar();
      if (!resultado.ok) {
        cursosVisibles = [];
        lista.replaceChildren(
          crearEstadoVacioAdmin(resultado.mensaje || "No se pudieron cargar los cursos.")
        );
        return resultado;
      }
      pintarCursos(resultado.data);
      return resultado;
    } finally {
      cargaEnCurso = false;
      actualizarDisponibilidad();
    }
  }

  return Object.freeze({ cargarCursos, estaOcupado: () => mutacionEnCurso || cargaEnCurso });
}

async function iniciarAdministracionCursos() {
  const arranque = crearArranqueAdmin({
    pagina: "course_admin_grid",
    tituloError: "No se pudo abrir la administración de cursos",
  });

  const inicioStartup = arranque.iniciarTiempo();
  if (!(await arranque.asegurarAdmin(inicioStartup))) return;

  const lista = document.getElementById("cursosAdminLista");
  const administrador = crearAdministradorCursos({
    lista,
    listar: listarCursos,
    eliminar: eliminarCurso,
    cambiarEstado: actualizarEstadoCurso,
    confirmar: confirmarConTexto,
    yaAnunciado: cursoYaAnunciado,
    notificar: mostrarToast,
    reportarFallo: arranque.reportarFallo,
    iniciarTiempo: arranque.iniciarTiempo,
    enfocar: (id) => {
      const destino = document.getElementById(id) || document.getElementById("cursoNuevo") || lista;
      destino?.focus?.();
    },
  });

  try {
    const resultado = await administrador.cargarCursos();
    if (!resultado.ok) {
      arranque.reportarFallo("course_admin_grid_load", null, inicioStartup, resultado.codigo || "list_failed");
    }
  } catch (error) {
    arranque.reportarFallo("course_admin_grid_load", error, inicioStartup, "list_exception");
    lista.replaceChildren(
      crearEstadoVacioAdmin("No se pudieron cargar los cursos. Intenta de nuevo más tarde.")
    );
  }

  arranque.revelar();
}

window.tauduxAdminCursos = {
  iniciar: iniciarAdministracionCursos,
};
window.tauduxAdminCursos.ready = window.tauduxAdminCursos.iniciar();
Object.freeze(window.tauduxAdminCursos);

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

function crearAdministradorCursos({
  lista,
  listar,
  eliminar,
  confirmar,
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

  function crearTarjetaCursoAdmin(curso, indice) {
    const tarjeta = document.createElement("article");
    tarjeta.className = "courses__card panel";
    tarjeta.dataset.cursoId = curso.id;

    const media = document.createElement("div");
    media.className = "courses__card-media courses__card-media--fallback";
    media.setAttribute("aria-hidden", "true");

    const badge = document.createElement("span");
    badge.className = "courses__card-updated-badge";
    const fechaPlaceholder = FECHAS_ACTUALIZACION_PLACEHOLDER[
      indice % FECHAS_ACTUALIZACION_PLACEHOLDER.length
    ];
    badge.textContent = `Actualizado: ${fechaPlaceholder}`;

    const mediaLabel = document.createElement("span");
    mediaLabel.className = "courses__card-media-label";
    mediaLabel.textContent = "TAUDUX / ACADEMY";

    const mediaTopic = document.createElement("span");
    mediaTopic.className = "courses__card-media-topic";
    mediaTopic.textContent = (curso.categoria || "Formación tecnológica").toUpperCase();

    media.append(badge, mediaLabel, mediaTopic);
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
    editar.href = `/src/app/features/courses/editar-curso.html?id=${encodeURIComponent(curso.id)}`;
    editar.textContent = "Editar";
    editar.setAttribute("aria-label", `Editar curso ${curso.titulo}`);

    const eliminar = document.createElement("button");
    eliminar.className = "button courses__action courses__action--danger";
    eliminar.id = `curso-eliminar-${curso.id}`;
    eliminar.type = "button";
    eliminar.textContent = "Eliminar";
    eliminar.setAttribute("aria-label", `Eliminar curso ${curso.titulo}`);
    eliminar.addEventListener("click", () => confirmarEliminacion(curso, eliminar));

    acciones.append(editar, eliminar);
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
    confirmar: confirmarConTexto,
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

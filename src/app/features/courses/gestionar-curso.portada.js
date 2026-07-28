/*
  Todo lo que el formulario de curso sabe sobre su portada: el estado de edición
  (conservar / reemplazar / retirar), el recortador, el arrastre sobre el lienzo
  y el retiro de la imagen actual.

  El controlador solo consume la superficie que devuelve crearControlPortada; no
  toca el cropper ni los elementos del recortador directamente.

  Depende de course-cover-cropper.js, portadas-curso.service.js y toast.js.
*/

/*
  Máquina de estados de la portada durante la edición:
  - "retain"      conserva la que ya tiene el curso
  - "replacement" reemplaza por el archivo elegido
  - "empty"       no hay ni actual ni nueva
  El retiro solo se confirma cuando el servidor ya disoció la imagen.
*/
function crearEstadoPortadaEdicion(cursoActual = null) {
  let actual = {
    url: cursoActual?.imagen_url || null,
    path: cursoActual?.imagen_storage_path || null,
  };
  let archivo = null;

  function faseActual() {
    if (archivo) return "replacement";
    return actual.url ? "retain" : "empty";
  }

  return Object.freeze({
    seleccionarArchivo(nuevoArchivo) {
      archivo = nuevoArchivo || null;
      return faseActual();
    },
    confirmarRetiro() {
      actual = { url: null, path: null };
      archivo = null;
    },
    obtenerActual: () => ({ ...actual }),
    obtenerArchivo: () => archivo,
    tieneActual: () => Boolean(actual.url),
  });
}

function crearManejadorRetiroPortada({
  obtenerCursoId,
  obtenerEstadoEdicion,
  confirmar,
  quitar,
  bloquearControles,
  elementosFormulario,
  controlesPortada,
  boton,
  inputArchivo,
  accionesActuales,
  estado,
  ocultarError,
  reportarFallo,
  mostrarToast,
  mostrarError,
  iniciarTiempo,
  confirmarEstadoLocal,
}) {
  let enCurso = false;

  function mensajeExito(resultado) {
    const status = resultado?.cleanup?.status;
    if (status === "deleted") return "La imagen se quitó del curso y de Storage.";
    if (status === "retained_shared") {
      return "La imagen se quitó del curso; el archivo se conserva porque otra portada lo usa.";
    }
    if (status === "queued" || resultado?.cleanup?.pending) {
      return "La imagen se quitó del curso. La limpieza de Storage quedó pendiente.";
    }
    return "La imagen actual se quitó del curso.";
  }

  function mensajeConfirmacion(reemplazoSeleccionado) {
    return reemplazoSeleccionado
      ? "Se quitará la imagen actual y se descartará el archivo seleccionado. ¿Deseas continuar?"
      : "¿Deseas quitar la imagen actual de este curso?";
  }

  const manejarRetiro = async () => {
    const cursoIdActual = obtenerCursoId();
    const estadoEdicion = obtenerEstadoEdicion();
    if (enCurso || !cursoIdActual || !estadoEdicion.tieneActual()) {
      return { ok: false, codigo: enCurso ? "removal_in_progress" : "no_current_cover" };
    }
    const reemplazoSeleccionado = Boolean(estadoEdicion.obtenerArchivo());
    if (!confirmar(mensajeConfirmacion(reemplazoSeleccionado))) {
      return { ok: false, codigo: "cancelled" };
    }

    enCurso = true;
    controlesPortada.setAttribute("aria-busy", "true");
    const restaurar = bloquearControles(elementosFormulario);
    const textoBoton = boton.textContent;
    boton.textContent = "Quitando imagen...";
    estado.textContent = "Quitando la imagen actual.";
    ocultarError();
    const inicio = iniciarTiempo();
    try {
      const resultado = await quitar(cursoIdActual, estadoEdicion.obtenerActual());
      estadoEdicion.confirmarRetiro();
      confirmarEstadoLocal();
      inputArchivo.value = "";
      accionesActuales.hidden = true;
      estado.textContent = mensajeExito(resultado);
      estado.focus();
      if (resultado?.cleanup?.pending) mostrarToast(estado.textContent, "warning");
      return { ok: true, resultado };
    } catch (error) {
      const mensajeUsuario = error?.message || "No se pudo quitar la imagen actual.";
      reportarFallo("course_cover_remove", error, inicio, error?.code || "removal_failed");
      mostrarToast(mensajeUsuario, "error");
      mostrarError(mensajeUsuario);
      return { ok: false, codigo: error?.code || "removal_failed", error };
    } finally {
      restaurar();
      boton.textContent = textoBoton;
      controlesPortada.setAttribute("aria-busy", "false");
      enCurso = false;
    }
  };
  manejarRetiro.estaEnCurso = () => enCurso;
  return manejarRetiro;
}

/*
  Cablea la sección de portada del formulario y devuelve la superficie mínima
  que el controlador necesita. `alConfirmarRetiro` deja que el controlador
  olvide la portada del curso que tiene cargado en memoria.
*/
function crearControlPortada({
  formulario,
  obtenerCursoId,
  alConfirmarRetiro,
  iniciarTiempo,
  reportarFallo,
  mostrarErrorOperacion,
  ocultarErrorOperacion,
}) {
  const inputArchivo = document.getElementById("cursoPortada");
  const controles = document.getElementById("cursoPortadaControles");
  const accionesActuales = document.getElementById("cursoPortadaActualAcciones");
  const botonQuitar = document.getElementById("cursoQuitarPortadaActual");
  const estado = document.getElementById("cursoPortadaEstado");
  const error = document.getElementById("cursoPortadaError");
  const recortador = document.getElementById("cursoPortadaRecortador");
  const lienzo = document.getElementById("cursoPortadaLienzo");
  const zoom = document.getElementById("cursoPortadaZoom");
  const botonRestablecer = document.getElementById("cursoPortadaRestablecer");

  let estadoEdicion = crearEstadoPortadaEdicion();
  let puntero = null;

  const cropper = window.courseCoverCropper.create({
    canvas: lienzo,
    onStateChange: reflejarEstadoCropper,
  });

  const quitarActual = crearManejadorRetiroPortada({
    obtenerCursoId,
    obtenerEstadoEdicion: () => estadoEdicion,
    confirmar: (mensaje) => window.confirm(mensaje),
    quitar: (id, portada) => window.portadasCurso.quitar(id, portada),
    bloquearControles: window.portadasCurso.bloquearControles,
    elementosFormulario: formulario.elements,
    controlesPortada: controles,
    boton: botonQuitar,
    inputArchivo,
    accionesActuales,
    estado,
    ocultarError: ocultarErrorOperacion,
    reportarFallo,
    mostrarToast,
    mostrarError: mostrarErrorOperacion,
    iniciarTiempo,
    confirmarEstadoLocal: () => {
      alConfirmarRetiro();
      cerrarRecortador();
    },
  });

  function cerrarRecortador() {
    cropper.destroy();
    recortador.hidden = true;
    error.hidden = true;
  }

  function reflejarEstadoCropper(estadoCropper) {
    const ocupado = estadoCropper.phase === "decoding" || estadoCropper.phase === "exporting";
    const listo = estadoCropper.phase === "ready";
    controles.setAttribute("aria-busy", String(ocupado));
    zoom.disabled = ocupado || !listo;
    botonRestablecer.disabled = ocupado || !listo;
    if (estadoCropper.phase === "decoding") estado.textContent = "Preparando la imagen para recortarla.";
    if (listo) estado.textContent = "El recorte está listo.";
    if (estadoCropper.phase === "exporting") estado.textContent = "Generando la portada.";
    error.hidden = !estadoCropper.error;
    error.textContent = estadoCropper.error || "";
  }

  function iniciarArrastre(evento) {
    if (cropper.getState().phase !== "ready" || puntero !== null) return;
    puntero = { id: evento.pointerId, x: evento.clientX, y: evento.clientY };
    lienzo.setPointerCapture(evento.pointerId);
  }

  function mover(evento) {
    if (!puntero || evento.pointerId !== puntero.id) return;
    cropper.pan(evento.clientX - puntero.x, evento.clientY - puntero.y);
    puntero.x = evento.clientX;
    puntero.y = evento.clientY;
  }

  function terminarArrastre(evento) {
    if (!puntero || evento.pointerId !== puntero.id) return;
    lienzo.releasePointerCapture?.(evento.pointerId);
    puntero = null;
  }

  async function seleccionarArchivoLocal() {
    const archivo = inputArchivo.files?.[0];
    estadoEdicion.seleccionarArchivo(archivo || null);
    if (!archivo) {
      cerrarRecortador();
      estado.textContent = estadoEdicion.tieneActual() ? "Se conservará la imagen actual." : "";
      return;
    }
    recortador.hidden = false;
    zoom.value = "1";
    try {
      await cropper.load(archivo);
    } catch {
      estadoEdicion.seleccionarArchivo(null);
      error.focus();
    }
  }

  inputArchivo.addEventListener("change", seleccionarArchivoLocal);
  zoom.addEventListener("input", () => cropper.setZoom(zoom.value));
  botonRestablecer.addEventListener("click", () => {
    cropper.reset();
    zoom.value = "1";
    estado.textContent = "El recorte se restableció.";
  });
  lienzo.addEventListener("pointerdown", iniciarArrastre);
  lienzo.addEventListener("pointermove", mover);
  lienzo.addEventListener("pointerup", terminarArrastre);
  lienzo.addEventListener("pointercancel", terminarArrastre);
  botonQuitar.addEventListener("click", quitarActual);

  const observador = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => cropper.render())
    : null;
  observador?.observe(lienzo);
  window.addEventListener("pagehide", () => {
    observador?.disconnect();
    cropper.destroy();
  }, { once: true });

  return Object.freeze({
    // Rearma el estado cuando el formulario termina de cargar un curso a editar.
    adoptarCurso(curso) {
      estadoEdicion = crearEstadoPortadaEdicion(curso);
    },
    // Refleja en la UI la portada que el curso ya tenía guardada.
    mostrarPortadaCargada() {
      accionesActuales.hidden = !estadoEdicion.tieneActual();
      estado.textContent = estadoEdicion.tieneActual()
        ? "Se conservará la imagen actual si no eliges otro archivo."
        : "";
    },
    archivoSeleccionado: () => inputArchivo.files?.[0] || null,
    portadaEsperada: () => estadoEdicion.obtenerActual(),
    estaRetirando: () => quitarActual.estaEnCurso(),
    /*
      Genera el JPEG recortado justo antes de enviar. Devuelve { ok: false }
      —ya habiendo avisado al usuario— si el recorte todavía no está listo o si
      la exportación falla; el llamador solo debe abortar el envío.
    */
    async generarArchivo() {
      if (!inputArchivo.files?.[0]) return { ok: true, archivo: null };
      if (cropper.getState().phase !== "ready") {
        error.hidden = false;
        error.textContent = "Espera a que el recorte esté listo antes de continuar.";
        error.focus();
        return { ok: false };
      }
      try {
        return { ok: true, archivo: await cropper.exportFile() };
      } catch (fallo) {
        mostrarToast(fallo?.message || "No se pudo generar la portada.", "error");
        error.focus();
        return { ok: false };
      }
    },
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    crearEstadoPortadaEdicion,
    crearManejadorRetiroPortada,
    crearControlPortada,
  });
}

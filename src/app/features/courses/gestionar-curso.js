/*
  Formulario reutilizable para crear o editar un curso. La presencia de un único
  `id` UUID activa edición y exige cargar ese curso; nunca degrada a creación.
  Requiere sesión y rol admin. Depende de auth, categorías, cursos, telemetría y
  toast.
*/

(async () => {
  function crearDatosEnvioCurso({
    titulo,
    datosCategoria,
    descripcion,
    modalidad,
    fechaInicio,
    fechaFin,
    proximamente,
    diasSemana,
    horaInicio,
    duracionHoras,
    cupoMaximo,
    costo,
    instructor,
  }, cursoActual) {
    return {
      titulo: titulo.trim(),
      ...datosCategoria,
      descripcion: descripcion.trim(),
      modalidad,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      proximamente,
      dias_semana: diasSemana,
      hora_inicio: horaInicio,
      duracion_horas: duracionHoras,
      cupo_maximo: cupoMaximo,
      costo,
      instructor: instructor.trim(),
      imagen_url: cursoActual?.imagen_url || "",
      imagen_storage_path: cursoActual?.imagen_storage_path || null,
    };
  }

  function crearEstadoPortadaEdicion(cursoActual = null) {
    let actual = {
      url: cursoActual?.imagen_url || null,
      path: cursoActual?.imagen_storage_path || null,
    };
    let archivo = null;
    return Object.freeze({
      seleccionarArchivo(nuevoArchivo) {
        archivo = nuevoArchivo || null;
        return archivo ? "replacement" : actual.url ? "retain" : "empty";
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

    const manejarRetiro = async () => {
      const cursoIdActual = obtenerCursoId();
      const estadoEdicion = obtenerEstadoEdicion();
      if (enCurso || !cursoIdActual || !estadoEdicion.tieneActual()) {
        return { ok: false, codigo: enCurso ? "removal_in_progress" : "no_current_cover" };
      }
      const reemplazoSeleccionado = Boolean(estadoEdicion.obtenerArchivo());
      const mensaje = reemplazoSeleccionado
        ? "Se quitará la imagen actual y se descartará el archivo seleccionado. ¿Deseas continuar?"
        : "¿Deseas quitar la imagen actual de este curso?";
      if (!confirmar(mensaje)) return { ok: false, codigo: "cancelled" };

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

  if (typeof module === "object" && module.exports) {
    module.exports = Object.freeze({
      crearDatosEnvioCurso,
      crearEstadoPortadaEdicion,
      crearManejadorRetiroPortada,
    });
    return;
  }

  const arranque = crearArranqueAdmin({
    pagina: "course_admin_form",
    tituloError: "No se pudo abrir el formulario",
  });
  const { iniciarTiempo, reportarFallo } = arranque;
  const RUTA_LISTA = RUTA_CATALOGO_CURSOS;
  const VALOR_CATEGORIA_SIN_ASIGNAR = "__sin_categoria__";
  const PREFIJO_CATEGORIA_LEGACY = "__categoria_legacy__:";
  // Un curso puede tener cualquier UUID v1-v8; comparte forma con el token de
  // portada, que también lo emite el servidor.
  const UUID_CURSO = UUID_TOKEN_PORTADA;

  const form = document.getElementById("cursoForm");
  const panel = document.getElementById("cursoPanel");
  const estadoRuta = document.getElementById("cursoRutaEstado");
  const mensajeRuta = document.getElementById("cursoRutaMensaje");
  const botonReintentarRuta = document.getElementById("cursoRutaReintentar");
  const tituloPagina = document.getElementById("cursoPaginaTitulo");
  const contextoPagina = document.getElementById("cursoPaginaContexto");
  const inputTitulo = document.getElementById("cursoTitulo");
  const inputCategoria = document.getElementById("cursoCategoria");
  const inputDescripcion = document.getElementById("cursoDescripcion");
  const inputModalidad = document.getElementById("cursoModalidad");
  const inputFechaInicio = document.getElementById("cursoFechaInicio");
  const inputFechaFin = document.getElementById("cursoFechaFin");
  const checksDias = Array.from(document.querySelectorAll(".courses__dias input"));
  const inputHora = document.getElementById("cursoHora");
  const inputDuracion = document.getElementById("cursoDuracion");
  const inputProximamente = document.getElementById("cursoProximamente");
  const controlesProgramacion = [inputHora, inputDuracion, inputFechaInicio, inputFechaFin];
  const inputCupo = document.getElementById("cursoCupo");
  const inputCosto = document.getElementById("cursoCosto");
  const inputInstructor = document.getElementById("cursoInstructor");
  const inputPortada = document.getElementById("cursoPortada");
  const controlesPortada = document.getElementById("cursoPortadaControles");
  const accionesPortadaActual = document.getElementById("cursoPortadaActualAcciones");
  const botonQuitarPortadaActual = document.getElementById("cursoQuitarPortadaActual");
  const estadoPortada = document.getElementById("cursoPortadaEstado");
  const errorPortada = document.getElementById("cursoPortadaError");
  const recortadorPortada = document.getElementById("cursoPortadaRecortador");
  const lienzoPortada = document.getElementById("cursoPortadaLienzo");
  const zoomPortada = document.getElementById("cursoPortadaZoom");
  const botonRestablecerPortada = document.getElementById("cursoPortadaRestablecer");
  const botonEnviar = document.getElementById("cursoEnviar");
  const botonCancelar = document.getElementById("cursoCancelar");
  const estadoCategorias = document.getElementById("categoriasEstado");
  const mensajeEstadoCategorias = document.getElementById("categoriasEstadoMensaje");
  const panelEstadoCategorias = crearPanelEstadoCategorias(estadoCategorias, mensajeEstadoCategorias);
  const botonReintentarCategorias = document.getElementById("categoriasReintentar");
  const estadoOperacion = document.getElementById("cursoOperacionEstado");
  const mensajeOperacion = document.getElementById("cursoOperacionMensaje");

  let cursoId = null;
  let cursoEditando = null;
  let categorias = [];
  let modoCategorias = "cargando";
  let cargaCategoriasEnCurso = false;
  let secuenciaCargaCategorias = 0;
  let estadoPortadaEdicion = crearEstadoPortadaEdicion();
  let punteroPortada = null;
  const cropperPortada = window.courseCoverCropper.create({
    canvas: lienzoPortada,
    onStateChange: actualizarEstadoCropper,
  });
  const flujoMutacionCurso = window.portadasCurso.crearFlujoMutacionCurso({
    subirPortada: window.portadasCurso.subir,
    crearCurso,
    actualizarCurso,
    generarOperacionId: generarIdOperacionCurso,
  });
  const quitarPortadaActual = crearManejadorRetiroPortada({
    obtenerCursoId: () => cursoId,
    obtenerEstadoEdicion: () => estadoPortadaEdicion,
    confirmar: (mensaje) => window.confirm(mensaje),
    quitar: (id, portada) => window.portadasCurso.quitar(id, portada),
    bloquearControles: window.portadasCurso.bloquearControles,
    elementosFormulario: form.elements,
    controlesPortada,
    boton: botonQuitarPortadaActual,
    inputArchivo: inputPortada,
    accionesActuales: accionesPortadaActual,
    estado: estadoPortada,
    ocultarError: ocultarErrorOperacion,
    reportarFallo,
    mostrarToast,
    mostrarError: mostrarErrorOperacion,
    iniciarTiempo,
    confirmarEstadoLocal: () => {
      cursoEditando.imagen_url = null;
      cursoEditando.imagen_storage_path = null;
      cropperPortada.destroy();
      recortadorPortada.hidden = true;
      errorPortada.hidden = true;
    },
  });

  form.addEventListener("submit", enviarFormulario);
  form.addEventListener("input", invalidarOperacionSiCambio);
  form.addEventListener("change", invalidarOperacionSiCambio);
  botonCancelar.addEventListener("click", () => {
    window.location.href = RUTA_LISTA;
  });
  botonReintentarCategorias.addEventListener("click", reintentarCategorias);
  botonReintentarRuta.addEventListener("click", () => window.location.reload());
  inputProximamente.addEventListener("change", actualizarEstadoProgramacion);
  inputPortada.addEventListener("change", seleccionarPortadaLocal);
  zoomPortada.addEventListener("input", () => cropperPortada.setZoom(zoomPortada.value));
  botonRestablecerPortada.addEventListener("click", () => {
    cropperPortada.reset();
    zoomPortada.value = "1";
    estadoPortada.textContent = "El recorte se restableció.";
  });
  lienzoPortada.addEventListener("pointerdown", iniciarArrastrePortada);
  lienzoPortada.addEventListener("pointermove", moverPortada);
  lienzoPortada.addEventListener("pointerup", terminarArrastrePortada);
  lienzoPortada.addEventListener("pointercancel", terminarArrastrePortada);
  botonQuitarPortadaActual.addEventListener("click", quitarPortadaActual);
  const observadorPortada = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => cropperPortada.render())
    : null;
  observadorPortada?.observe(lienzoPortada);
  window.addEventListener("pagehide", () => {
    observadorPortada?.disconnect();
    cropperPortada.destroy();
  }, { once: true });

  const inicioStartup = iniciarTiempo();
  if (!(await arranque.asegurarAdmin(inicioStartup))) return;

  let rutaValida;
  try {
    rutaValida = await configurarModo();
  } catch (error) {
    reportarFallo("course_form_startup", error, inicioStartup, "form_startup_exception");
    arranque.mostrarError("No se pudo preparar el formulario. Vuelve a intentarlo.");
    return;
  }
  if (!rutaValida) {
    arranque.revelar();
    estadoRuta.focus();
    return;
  }

  try {
    await cargarCategorias();
    if (cursoEditando) poblarFormulario(cursoEditando);
    actualizarEstadoProgramacion();
    panel.hidden = false;
    arranque.revelar();
  } catch (error) {
    reportarFallo("course_form_startup", error, inicioStartup, "form_startup_exception");
    arranque.mostrarError("No se pudo preparar el formulario. Vuelve a intentarlo.");
    return;
  }

  async function configurarModo() {
    const parametros = new URLSearchParams(window.location.search);
    const ids = parametros.getAll("id");
    if (ids.length === 0) return true;
    if (ids.length !== 1 || !UUID_CURSO.test(ids[0])) {
      mostrarErrorRuta("El identificador del curso no es válido. Vuelve a la lista e inténtalo de nuevo.");
      return false;
    }

    cursoId = ids[0];
    const inicio = iniciarTiempo();
    let resultado;
    try {
      resultado = await obtenerCursoPorId(cursoId);
    } catch (error) {
      reportarFallo("course_edit_load", error, inicio, "edit_load_exception");
      mostrarErrorRuta(
        "No se pudo cargar el curso. Revisa tu conexión y vuelve a intentarlo.",
        true
      );
      return false;
    }
    if (!resultado.ok) {
      reportarFallo(
        "course_edit_load",
        null,
        inicio,
        resultado.codigo || "edit_load_failed"
      );
      mostrarErrorRuta(resultado.mensaje || "No se pudo cargar el curso.", true);
      return false;
    }
    if (!resultado.data) {
      mostrarErrorRuta("El curso solicitado no existe o ya fue eliminado.");
      return false;
    }

    cursoEditando = resultado.data;
    estadoPortadaEdicion = crearEstadoPortadaEdicion(cursoEditando);
    modoCategorias = resultado.modoCategorias;
    tituloPagina.textContent = "Editar curso";
    contextoPagina.textContent = `Editando el curso: ${cursoEditando.titulo || "curso sin título"}.`;
    botonEnviar.textContent = "Guardar cambios";
    document.title = "Editar curso | Taudux";
    return true;
  }

  function mostrarErrorRuta(mensaje, permitirReintento = false) {
    panel.hidden = true;
    mensajeRuta.textContent = mensaje;
    botonReintentarRuta.hidden = !permitirReintento;
    estadoRuta.hidden = false;
    document.title = "Curso no disponible | Taudux";
  }

  function actualizarEstadoProgramacion() {
    const esProximamente = inputProximamente.checked;
    controlesProgramacion.forEach((control) => {
      if (esProximamente) control.value = "";
      control.disabled = esProximamente;
      control.required = !esProximamente;
    });
    checksDias.forEach((check) => {
      if (esProximamente) check.checked = false;
      check.disabled = esProximamente;
    });
  }

  function actualizarEstadoCropper(estado) {
    const ocupado = estado.phase === "decoding" || estado.phase === "exporting";
    controlesPortada.setAttribute("aria-busy", String(ocupado));
    zoomPortada.disabled = ocupado || estado.phase !== "ready";
    botonRestablecerPortada.disabled = ocupado || estado.phase !== "ready";
    if (estado.phase === "decoding") estadoPortada.textContent = "Preparando la imagen para recortarla.";
    if (estado.phase === "ready") estadoPortada.textContent = "El recorte está listo.";
    if (estado.phase === "exporting") estadoPortada.textContent = "Generando la portada.";
    errorPortada.hidden = !estado.error;
    errorPortada.textContent = estado.error || "";
  }

  function iniciarArrastrePortada(evento) {
    if (cropperPortada.getState().phase !== "ready" || punteroPortada !== null) return;
    punteroPortada = { id: evento.pointerId, x: evento.clientX, y: evento.clientY };
    lienzoPortada.setPointerCapture(evento.pointerId);
  }

  function moverPortada(evento) {
    if (!punteroPortada || evento.pointerId !== punteroPortada.id) return;
    cropperPortada.pan(evento.clientX - punteroPortada.x, evento.clientY - punteroPortada.y);
    punteroPortada.x = evento.clientX;
    punteroPortada.y = evento.clientY;
  }

  function terminarArrastrePortada(evento) {
    if (!punteroPortada || evento.pointerId !== punteroPortada.id) return;
    lienzoPortada.releasePointerCapture?.(evento.pointerId);
    punteroPortada = null;
  }

  async function seleccionarPortadaLocal() {
    const archivo = inputPortada.files?.[0];
    estadoPortadaEdicion.seleccionarArchivo(archivo || null);
    if (!archivo) {
      cropperPortada.destroy();
      recortadorPortada.hidden = true;
      errorPortada.hidden = true;
      estadoPortada.textContent = estadoPortadaEdicion.tieneActual()
        ? "Se conservará la imagen actual."
        : "";
      return;
    }
    recortadorPortada.hidden = false;
    zoomPortada.value = "1";
    try {
      await cropperPortada.load(archivo);
    } catch {
      estadoPortadaEdicion.seleccionarArchivo(null);
      errorPortada.focus();
    }
  }

  async function cargarCategorias() {
    const solicitud = ++secuenciaCargaCategorias;
    const seleccionPrevia = obtenerSeleccionCategoria();
    const inicio = iniciarTiempo();
    cargaCategoriasEnCurso = true;
    let falloReportado = false;
    inputCategoria.disabled = true;
    botonReintentarCategorias.disabled = true;

    let resultado;
    try {
      resultado = await listarCategorias({ incluirInactivas: true });
    } catch (error) {
      reportarFallo("course_form_category_load", error, inicio, "category_load_exception");
      falloReportado = true;
      resultado = { ok: false, mensaje: "No se pudieron cargar las categorías." };
    }
    if (solicitud !== secuenciaCargaCategorias) return false;

    if (resultado.ok) {
      categorias = resultado.data.map((categoria) => ({ ...categoria, legacy: false }));
      modoCategorias = "normalizado";
      panelEstadoCategorias.ocultar();
    } else {
      if (!falloReportado) {
        reportarFallo(
          "course_form_category_load",
          null,
          inicio,
          resultado.migracionRequerida ? "migration_required" : "category_load_failed"
        );
      }
      categorias = categoriasLegacy(cursoEditando?.categoria ? [cursoEditando.categoria] : []);
      if (resultado.migracionRequerida) {
        modoCategorias = "legacy";
        panelEstadoCategorias.mostrar(
          "migration",
          "Se requiere aplicar la migración 0010 en Supabase. Puedes guardar el curso con las opciones heredadas."
        );
      } else {
        modoCategorias = modoCategorias === "normalizado" ? "normalizado" : "legacy";
        panelEstadoCategorias.mostrar(
          "error",
          "No se pudieron actualizar las categorías. Se muestran las opciones heredadas; reintenta cuando tengas conexión."
        );
      }
    }

    poblarSelectCategorias(cursoEditando, seleccionPrevia);
    cargaCategoriasEnCurso = false;
    botonReintentarCategorias.disabled = false;
    return resultado.ok;
  }

  async function reintentarCategorias() {
    if (cargaCategoriasEnCurso) return;
    const cargadas = await cargarCategorias();
    (cargadas ? inputCategoria : estadoCategorias).focus();
  }

  function crearOpcionCategoria(valor, nombre, modo, texto = nombre) {
    const opcion = document.createElement("option");
    opcion.value = valor;
    opcion.textContent = texto;
    opcion.dataset.nombre = nombre || "";
    opcion.dataset.modo = modo;
    return opcion;
  }

  function poblarSelectCategorias(cursoActual = null, seleccionPreferida = null) {
    inputCategoria.textContent = "";
    inputCategoria.appendChild(
      crearOpcionCategoria(VALOR_CATEGORIA_SIN_ASIGNAR, "", "ninguna", "Sin categoría")
    );

    const activas = categorias.filter((categoria) => categoria.legacy || categoria.activo);
    activas.forEach((categoria) => {
      const modo = categoria.legacy ? "legacy" : "normalizado";
      const valor = categoria.legacy
        ? `${PREFIJO_CATEGORIA_LEGACY}${encodeURIComponent(categoria.nombre)}`
        : categoria.id;
      inputCategoria.appendChild(crearOpcionCategoria(valor, categoria.nombre, modo));
    });

    const idActual = cursoActual?.categoria_id || null;
    const categoriaActual = idActual
      ? categorias.find((categoria) => categoria.id === idActual) || cursoActual.categoria_rel
      : null;
    if (categoriaActual && !activas.some((categoria) => categoria.id === idActual)) {
      const texto = categoriaActual.activo === false
        ? `${categoriaActual.nombre} (inactiva)`
        : categoriaActual.nombre;
      inputCategoria.appendChild(
        crearOpcionCategoria(idActual, categoriaActual.nombre, "normalizado", texto)
      );
    }
    if (cursoActual?.categoria && !opcionCategoriaPorNombre(cursoActual.categoria)) {
      inputCategoria.appendChild(crearOpcionCategoria(
        `${PREFIJO_CATEGORIA_LEGACY}${encodeURIComponent(cursoActual.categoria)}`,
        cursoActual.categoria,
        "legacy",
        `${cursoActual.categoria} (heredada)`
      ));
    }

    const opcionPreferida = buscarOpcionCompatible(seleccionPreferida);
    const opcionActual = idActual
      ? Array.from(inputCategoria.options).find((opcion) => opcion.value === idActual)
      : opcionCategoriaPorNombre(cursoActual?.categoria);
    inputCategoria.value =
      (opcionPreferida || opcionActual)?.value || VALOR_CATEGORIA_SIN_ASIGNAR;
    inputCategoria.disabled = false;
  }

  function opcionCategoriaPorNombre(nombre) {
    if (!nombre) return null;
    return Array.from(inputCategoria.options).find(
      (opcion) => opcion.dataset.nombre.toLocaleLowerCase("es-MX") === nombre.toLocaleLowerCase("es-MX")
    );
  }

  function buscarOpcionCompatible(seleccion) {
    if (!seleccion) return null;
    const opciones = Array.from(inputCategoria.options);
    return opciones.find((opcion) => opcion.value === seleccion.valor) ||
      opciones.find((opcion) =>
        seleccion.nombre && opcion.dataset.nombre.toLocaleLowerCase("es-MX") ===
          seleccion.nombre.toLocaleLowerCase("es-MX")
      ) || null;
  }

  function obtenerSeleccionCategoria() {
    const opcion = Array.from(inputCategoria.options || []).find(
      (candidata) => candidata.value === inputCategoria.value
    );
    return opcion ? {
      valor: opcion.value,
      nombre: opcion.dataset.nombre || null,
      modo: opcion.dataset.modo,
    } : null;
  }

  function obtenerDatosCategoriaFormulario() {
    const seleccion = obtenerSeleccionCategoria();
    const ninguna = !seleccion || seleccion.modo === "ninguna";
    const modo = seleccion?.modo === "legacy"
      ? "legacy"
      : seleccion?.modo === "normalizado" || modoCategorias === "normalizado"
        ? "normalizado"
        : "legacy";
    return {
      categoria_id: ninguna || seleccion.modo !== "normalizado" ? null : seleccion.valor,
      categoria: ninguna ? null : seleccion.nombre,
      categoria_modo: modo,
    };
  }

  function poblarFormulario(curso) {
    inputTitulo.value = curso.titulo || "";
    poblarSelectCategorias(curso);
    inputDescripcion.value = curso.descripcion || "";
    inputModalidad.value = curso.modalidad || "";
    inputFechaInicio.value = curso.fecha_inicio || "";
    inputFechaFin.value = curso.fecha_fin || "";
    inputProximamente.checked = Boolean(curso.proximamente);
    const dias = curso.dias_semana || [];
    checksDias.forEach((check) => (check.checked = dias.includes(check.value)));
    inputHora.value = curso.hora_inicio || "";
    inputDuracion.value = curso.duracion_horas || "";
    inputCupo.value = curso.cupo_maximo || "";
    inputCosto.value = curso.costo ?? "";
    inputInstructor.value = curso.instructor || "";
    accionesPortadaActual.hidden = !estadoPortadaEdicion.tieneActual();
    estadoPortada.textContent = estadoPortadaEdicion.tieneActual()
      ? "Se conservará la imagen actual si no eliges otro archivo."
      : "";
  }

  function obtenerDatosFormulario() {
    const diasSeleccionados = checksDias
      .filter((check) => check.checked)
      .map((check) => check.value);
    return crearDatosEnvioCurso({
      titulo: inputTitulo.value,
      datosCategoria: obtenerDatosCategoriaFormulario(),
      descripcion: inputDescripcion.value,
      modalidad: inputModalidad.value,
      fechaInicio: inputFechaInicio.value,
      fechaFin: inputFechaFin.value,
      proximamente: inputProximamente.checked,
      diasSemana: diasSeleccionados,
      horaInicio: inputHora.value,
      duracionHoras: inputDuracion.value,
      cupoMaximo: inputCupo.value,
      costo: inputCosto.value,
      instructor: inputInstructor.value,
    }, cursoEditando);
  }

  function firmaSolicitud(datos = obtenerDatosFormulario(), archivo = inputPortada.files?.[0] || null) {
    const portada = archivo ? {
      name: archivo.name,
      size: archivo.size,
      type: archivo.type,
      lastModified: archivo.lastModified,
    } : null;
    return JSON.stringify({ datos, portada });
  }

  function generarIdOperacionCurso() {
    if (!window.crypto || typeof window.crypto.randomUUID !== "function") return null;
    const id = window.crypto.randomUUID().toLowerCase();
    return UUID_OPERACION_CURSO.test(id) ? id : null;
  }

  function invalidarOperacionSiCambio() {
    if (flujoMutacionCurso.estaEnCurso()) return;
    if (flujoMutacionCurso.invalidarOperacion(firmaSolicitud())) ocultarErrorOperacion();
  }

  function mostrarErrorOperacion(mensaje) {
    estadoOperacion.hidden = false;
    estadoOperacion.classList.add("courses__data-status--error");
    mensajeOperacion.textContent = mensaje;
    estadoOperacion.focus();
  }

  function ocultarErrorOperacion() {
    estadoOperacion.hidden = true;
    estadoOperacion.classList.remove("courses__data-status--error");
    mensajeOperacion.textContent = "";
  }

  async function enviarFormulario(evento) {
    evento.preventDefault();
    if (quitarPortadaActual.estaEnCurso()) return;
    const datos = obtenerDatosFormulario();
    const fuentePortada = inputPortada.files?.[0] || null;
    if (!inputProximamente.checked && datos.dias_semana.length === 0) {
      mostrarToast("Selecciona al menos un día de la semana.", "error");
      return;
    }

    ocultarErrorOperacion();
    const textoBoton = botonEnviar.textContent;
    const inicio = iniciarTiempo();
    let archivoPortada = null;
    if (fuentePortada) {
      if (cropperPortada.getState().phase !== "ready") {
        errorPortada.hidden = false;
        errorPortada.textContent = "Espera a que el recorte esté listo antes de continuar.";
        errorPortada.focus();
        return;
      }
      try {
        archivoPortada = await cropperPortada.exportFile();
      } catch (error) {
        const mensaje = error?.message || "No se pudo generar la portada.";
        mostrarToast(mensaje, "error");
        errorPortada.focus();
        return;
      }
    }
    const resultado = await flujoMutacionCurso.ejecutar({
      cursoId,
      datos,
      archivoPortada,
      portadaEsperada: cursoId ? estadoPortadaEdicion.obtenerActual() : null,
      firma: firmaSolicitud(datos, fuentePortada),
      controles: form.elements,
      alCambiarEtapa: (etapa) => {
        botonEnviar.textContent = etapa === "upload"
          ? "Subiendo portada..."
          : cursoId ? "Guardando..." : "Publicando...";
      },
    });
    botonEnviar.textContent = textoBoton;
    if (!resultado.ok) {
      reportarFallo(
        resultado.etapa === "upload" ? "course_cover_upload" : cursoId ? "course_update" : "course_create",
        resultado.error || null,
        inicio,
        resultado.codigo || (resultado.ambigua ? "create_confirmation_pending" : "save_failed")
      );
      mostrarToast(resultado.mensajeUsuario, "error");
      mostrarErrorOperacion(resultado.mensajeUsuario);
      return;
    }
    window.location.href = `${RUTA_LISTA}?resultado=${cursoId ? "actualizado" : "creado"}`;
  }
})();

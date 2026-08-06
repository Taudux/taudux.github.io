/*
  Formulario reutilizable para crear o editar un curso. La presencia de un único
  `id` UUID activa edición y exige cargar ese curso; nunca degrada a creación.
  Requiere sesión y rol admin.

  Este archivo es el controlador: lee y escribe los campos del formulario y
  orquesta el envío. La portada vive en gestionar-curso.portada.js y el <select>
  de categorías en gestionar-curso.categorias.js.

  Depende de auth, categorías, cursos, portadas, telemetría, admin-startup,
  toast y confirm-dialog (publicar exige confirmación simple desde la 0018,
  con aviso solo push desde la 0026: ver mensajePublicacionCurso).
*/

(() => {
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
    // El contenido de la 0020 es opcional de punta a punta: un llamador que no
    // lo conoce (o un curso viejo) produce el mismo payload que antes.
    dirigidoA = "",
    requisitos = "",
    herramientas = "",
    numeroSesiones = "",
    datosTemario = { temario: [] },
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
      dirigido_a: dirigidoA.trim(),
      requisitos: requisitos.trim(),
      herramientas: herramientas.trim(),
      numero_sesiones: numeroSesiones,
      ...datosTemario,
      imagen_url: cursoActual?.imagen_url || "",
      imagen_storage_path: cursoActual?.imagen_storage_path || null,
    };
  }

  // Migración 0018: publicar siempre reencola el aviso, incluso si el curso ya
  // fue anunciado antes. Migración 0026: ese aviso ahora es solo push, nunca
  // correo. Estos son los tres textos posibles del diálogo de confirmación
  // simple que antecede a ese envío masivo. Un curso nuevo (sin id) nunca fue
  // anunciado, así que no hace falta consultar el RPC.
  const TEXTO_AVISO_NUEVO =
    "Se enviará una notificación push a todos los usuarios suscritos que tengan la app instalada.";
  const TEXTO_AVISO_REENVIO =
    "Este curso ya fue anunciado antes. Al publicarlo se volverá a enviar la notificación push a todos los suscritos, incluidos los que ya la recibieron.";
  const TEXTO_AVISO_DESCONOCIDO =
    "No pudimos verificar si este curso ya fue anunciado. Al publicarlo se enviará una notificación push a todos los usuarios suscritos.";

  /*
    No bloquea ni publica en silencio si la consulta falla: usa el texto
    conservador y deja que decida el admin. `consultarAnuncio` es
    cursoYaAnunciado del servicio, inyectada para poder testear sin Supabase real.
  */
  async function mensajePublicacionCurso(cursoId, consultarAnuncio) {
    if (!cursoId) return TEXTO_AVISO_NUEVO;

    let resultado;
    try {
      resultado = await consultarAnuncio(cursoId);
    } catch {
      resultado = { ok: false };
    }
    if (!resultado || !resultado.ok) return TEXTO_AVISO_DESCONOCIDO;
    return resultado.data ? TEXTO_AVISO_REENVIO : TEXTO_AVISO_NUEVO;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = Object.freeze({ crearDatosEnvioCurso, mensajePublicacionCurso });
    return;
  }

  iniciarFormularioCurso();

  async function iniciarFormularioCurso() {
    const arranque = crearArranqueAdmin({
      pagina: "course_admin_form",
      tituloError: "No se pudo abrir el formulario",
    });
    const { iniciarTiempo, reportarFallo } = arranque;
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
    const inputDirigidoA = document.getElementById("cursoDirigidoA");
    const inputRequisitos = document.getElementById("cursoRequisitos");
    const inputHerramientas = document.getElementById("cursoHerramientas");
    const inputNumeroSesiones = document.getElementById("cursoNumeroSesiones");
    const contenedorTemario = document.getElementById("cursoTemarioModulos");
    const botonAgregarModulo = document.getElementById("cursoTemarioAgregar");
    const botonEnviar = document.getElementById("cursoEnviar");
    const botonCancelar = document.getElementById("cursoCancelar");
    const estadoCategorias = document.getElementById("categoriasEstado");
    const mensajeEstadoCategorias = document.getElementById("categoriasEstadoMensaje");
    const botonReintentarCategorias = document.getElementById("categoriasReintentar");
    const estadoOperacion = document.getElementById("cursoOperacionEstado");
    const mensajeOperacion = document.getElementById("cursoOperacionMensaje");
    const avisoBorrador = document.getElementById("cursoBorradorAviso");
    const botonRestaurarBorrador = document.getElementById("cursoBorradorRestaurar");
    const botonDescartarBorrador = document.getElementById("cursoBorradorDescartar");

    const panelEstadoCategorias = crearPanelEstadoCategorias(estadoCategorias, mensajeEstadoCategorias);
    const selectCategorias = crearControlCategoriasCurso(inputCategoria);

    /*
      Agregar o eliminar módulos y temas son clicks, no eventos `input`, así que
      la delegación de más abajo no los ve. El control avisa por acá para que el
      borrador y la clave de idempotencia se enteren igual que con cualquier
      otro cambio del formulario.
    */
    const controlTemario = crearControlTemarioCurso({
      contenedor: contenedorTemario,
      botonAgregar: botonAgregarModulo,
      alCambiar: () => {
        invalidarOperacionSiCambio();
        borradorCurso.registrarCambio();
      },
    });

    let cursoId = null;
    let cursoEditando = null;
    let modoCategorias = "cargando";
    let cargaCategoriasEnCurso = false;
    let secuenciaCargaCategorias = 0;
    let huellaBase = null;
    let datosBorradorPendiente = null;

    const borradorCurso = crearBorradorCurso({
      obtenerCursoId: () => cursoId,
      obtenerDatos: obtenerDatosFormulario,
      estaSucio: () => huellaBase !== null && firmaSolicitud() !== huellaBase,
      estaEnviando: () => flujoMutacionCurso.estaEnCurso(),
      ventana: window,
    });

    const portada = crearControlPortada({
      formulario: form,
      obtenerCursoId: () => cursoId,
      alConfirmarRetiro: () => {
        cursoEditando.imagen_url = null;
        cursoEditando.imagen_storage_path = null;
      },
      iniciarTiempo,
      reportarFallo,
      mostrarErrorOperacion,
      ocultarErrorOperacion,
    });

    const flujoMutacionCurso = window.portadasCurso.crearFlujoMutacionCurso({
      subirPortada: window.portadasCurso.subir,
      crearCurso,
      actualizarCurso,
      generarOperacionId: generarIdOperacionCurso,
    });

    form.addEventListener("submit", enviarFormulario);
    form.addEventListener("input", invalidarOperacionSiCambio);
    form.addEventListener("change", invalidarOperacionSiCambio);
    form.addEventListener("input", () => borradorCurso.registrarCambio());
    form.addEventListener("change", () => borradorCurso.registrarCambio());
    botonCancelar.addEventListener("click", () => {
      borradorCurso.abandonar();
      window.location.href = RUTA_CATALOGO_CURSOS;
    });
    botonReintentarCategorias.addEventListener("click", reintentarCategorias);
    botonReintentarRuta.addEventListener("click", () => window.location.reload());
    inputProximamente.addEventListener("change", actualizarEstadoProgramacion);
    botonRestaurarBorrador.addEventListener("click", restaurarBorrador);
    botonDescartarBorrador.addEventListener("click", descartarBorrador);

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
      prepararBorrador();
      panel.hidden = false;
      arranque.revelar();
    } catch (error) {
      reportarFallo("course_form_startup", error, inicioStartup, "form_startup_exception");
      arranque.mostrarError("No se pudo preparar el formulario. Vuelve a intentarlo.");
    }

    /*
      Sin `id` la pantalla crea; con un `id` válido edita ese curso y solo ese.
      Un `id` repetido, malformado o inexistente es un error de ruta explícito:
      nunca degradamos silenciosamente a "crear".
    */
    async function configurarModo() {
      const ids = new URLSearchParams(window.location.search).getAll("id");
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
        mostrarErrorRuta("No se pudo cargar el curso. Revisa tu conexión y vuelve a intentarlo.", true);
        return false;
      }
      if (!resultado.ok) {
        reportarFallo("course_edit_load", null, inicio, resultado.codigo || "edit_load_failed");
        mostrarErrorRuta(resultado.mensaje || "No se pudo cargar el curso.", true);
        return false;
      }
      if (!resultado.data) {
        mostrarErrorRuta("El curso solicitado no existe o ya fue eliminado.");
        return false;
      }

      cursoEditando = resultado.data;
      portada.adoptarCurso(cursoEditando);
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

    // Un curso "próximamente" no tiene fechas ni horario, así que esos controles
    // se vacían y dejan de ser obligatorios.
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

    async function listarCategoriasDelFormulario(inicio) {
      try {
        return { resultado: await listarCategorias({ incluirInactivas: true }), falloReportado: false };
      } catch (error) {
        reportarFallo("course_form_category_load", error, inicio, "category_load_exception");
        return {
          resultado: { ok: false, mensaje: "No se pudieron cargar las categorías." },
          falloReportado: true,
        };
      }
    }

    // Sin categorías normalizadas el formulario sigue siendo utilizable con las
    // opciones heredadas; el aviso explica por qué la lista está degradada.
    function aplicarCategoriasDegradadas(resultado, inicio, falloReportado) {
      if (!falloReportado) {
        reportarFallo(
          "course_form_category_load",
          null,
          inicio,
          resultado.migracionRequerida ? "migration_required" : "category_load_failed"
        );
      }
      const heredadaDelCurso = cursoEditando?.categoria ? [cursoEditando.categoria] : [];
      selectCategorias.reemplazarCategorias(categoriasLegacy(heredadaDelCurso));
      if (resultado.migracionRequerida) {
        modoCategorias = "legacy";
        panelEstadoCategorias.mostrar(
          "migration",
          "Se requiere aplicar la migración 0010 en Supabase. Puedes guardar el curso con las opciones heredadas."
        );
        return;
      }
      modoCategorias = modoCategorias === "normalizado" ? "normalizado" : "legacy";
      panelEstadoCategorias.mostrar(
        "error",
        "No se pudieron actualizar las categorías. Se muestran las opciones heredadas; reintenta cuando tengas conexión."
      );
    }

    async function cargarCategorias() {
      const solicitud = ++secuenciaCargaCategorias;
      const seleccionPrevia = selectCategorias.obtenerSeleccion();
      const inicio = iniciarTiempo();
      cargaCategoriasEnCurso = true;
      inputCategoria.disabled = true;
      botonReintentarCategorias.disabled = true;

      const { resultado, falloReportado } = await listarCategoriasDelFormulario(inicio);
      // Una carga más nueva ya está en vuelo: esta respuesta quedó obsoleta.
      if (solicitud !== secuenciaCargaCategorias) return false;

      if (resultado.ok) {
        selectCategorias.reemplazarCategorias(
          resultado.data.map((categoria) => ({ ...categoria, legacy: false }))
        );
        modoCategorias = "normalizado";
        panelEstadoCategorias.ocultar();
      } else {
        aplicarCategoriasDegradadas(resultado, inicio, falloReportado);
      }

      selectCategorias.poblar(cursoEditando, seleccionPrevia);
      cargaCategoriasEnCurso = false;
      botonReintentarCategorias.disabled = false;
      return resultado.ok;
    }

    async function reintentarCategorias() {
      if (cargaCategoriasEnCurso) return;
      const cargadas = await cargarCategorias();
      (cargadas ? inputCategoria : estadoCategorias).focus();
    }

    function poblarFormulario(curso) {
      inputTitulo.value = curso.titulo || "";
      selectCategorias.poblar(curso);
      inputDescripcion.value = curso.descripcion || "";
      inputModalidad.value = curso.modalidad || "";
      inputFechaInicio.value = curso.fecha_inicio || "";
      inputFechaFin.value = curso.fecha_fin || "";
      inputProximamente.checked = Boolean(curso.proximamente);
      const dias = curso.dias_semana || [];
      checksDias.forEach((check) => { check.checked = dias.includes(check.value); });
      inputHora.value = curso.hora_inicio || "";
      inputDuracion.value = curso.duracion_horas || "";
      inputCupo.value = curso.cupo_maximo || "";
      inputCosto.value = curso.costo ?? "";
      inputInstructor.value = curso.instructor || "";
      inputDirigidoA.value = curso.dirigido_a || "";
      inputRequisitos.value = curso.requisitos || "";
      inputHerramientas.value = curso.herramientas || "";
      inputNumeroSesiones.value = curso.numero_sesiones || "";
      controlTemario.poblar(curso);
      portada.mostrarPortadaCargada();
    }

    // Se corre tras el poblado inicial (servidor o formulario en blanco): esa
    // es la línea base contra la que se mide si el usuario ensució algo, y
    // recién ahí tiene sentido comparar un borrador guardado contra ella.
    function prepararBorrador() {
      const datosBase = obtenerDatosFormulario();
      huellaBase = firmaSolicitud(datosBase);
      const datosGuardados = borradorCurso.recuperar();
      borradorCurso.marcarListo();
      if (!datosGuardados || JSON.stringify(datosGuardados) === JSON.stringify(datosBase)) return;
      datosBorradorPendiente = datosGuardados;
      avisoBorrador.hidden = false;
    }

    function ocultarAvisoBorrador() {
      avisoBorrador.hidden = true;
      datosBorradorPendiente = null;
    }

    function restaurarBorrador() {
      if (!datosBorradorPendiente) return;
      poblarFormulario(datosBorradorPendiente);
      actualizarEstadoProgramacion();
      ocultarAvisoBorrador();
      // poblarFormulario asigna .value directamente y eso no dispara input/change,
      // así que hay que avisarle al borrador a mano que el formulario cambió.
      borradorCurso.registrarCambio();
    }

    function descartarBorrador() {
      borradorCurso.descartar();
      ocultarAvisoBorrador();
    }

    function obtenerDatosFormulario() {
      const diasSeleccionados = checksDias
        .filter((check) => check.checked)
        .map((check) => check.value);
      return crearDatosEnvioCurso({
        titulo: inputTitulo.value,
        datosCategoria: selectCategorias.datosParaEnvio(modoCategorias),
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
        dirigidoA: inputDirigidoA.value,
        requisitos: inputRequisitos.value,
        herramientas: inputHerramientas.value,
        numeroSesiones: inputNumeroSesiones.value,
        datosTemario: controlTemario.datosParaEnvio(),
      }, cursoEditando);
    }

    /*
      Huella del envío. Si el usuario edita algo tras un intento fallido, el
      UUID de operación retenido deja de ser válido y hay que generar otro; sin
      cambios, reintentar debe reusarlo para no publicar dos veces.
    */
    function firmaSolicitud(datos = obtenerDatosFormulario(), archivo = portada.archivoSeleccionado()) {
      const huellaPortada = archivo ? {
        name: archivo.name,
        size: archivo.size,
        type: archivo.type,
        lastModified: archivo.lastModified,
      } : null;
      return JSON.stringify({ datos, portada: huellaPortada });
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

    function operacionFallida(resultado) {
      if (resultado.etapa === "upload") return "course_cover_upload";
      return cursoId ? "course_update" : "course_create";
    }

    function textoBotonPorEtapa(etapa, estadoDestino) {
      if (etapa === "upload") return "Subiendo portada...";
      if (estadoDestino === "borrador") return "Guardando borrador...";
      return cursoId ? "Guardando..." : "Publicando...";
    }

    async function enviarFormulario(evento) {
      evento.preventDefault();
      if (portada.estaRetirando()) return;
      // Guardar borrador usa formnovalidate (un curso a medio llenar es
      // justamente el caso de uso), así que la única validación de "campos
      // completos" que debe aplicar es la de publicar de verdad.
      const botonClicado = evento.submitter || botonEnviar;
      const estadoDestino = botonClicado.dataset.estado === "borrador" ? "borrador" : "publicado";
      const datos = obtenerDatosFormulario();
      const fuentePortada = portada.archivoSeleccionado();
      if (estadoDestino === "publicado" && !inputProximamente.checked && datos.dias_semana.length === 0) {
        mostrarToast("Selecciona al menos un día de la semana.", "error");
        return;
      }

      if (estadoDestino === "publicado") {
        const mensaje = await mensajePublicacionCurso(cursoId, cursoYaAnunciado);
        const confirmado = await confirmarConTexto({
          titulo: "Publicar curso",
          mensaje,
          etiquetaConfirmar: "Publicar",
        });
        if (!confirmado) return;
      }

      ocultarErrorOperacion();
      const textoBoton = botonClicado.textContent;
      const inicio = iniciarTiempo();

      const generada = await portada.generarArchivo();
      if (!generada.ok) return;

      const resultado = await flujoMutacionCurso.ejecutar({
        cursoId,
        datos: { ...datos, estado: estadoDestino },
        archivoPortada: generada.archivo,
        portadaEsperada: cursoId ? portada.portadaEsperada() : null,
        firma: firmaSolicitud(datos, fuentePortada),
        controles: form.elements,
        alCambiarEtapa: (etapa) => {
          botonClicado.textContent = textoBotonPorEtapa(etapa, estadoDestino);
        },
      });
      botonClicado.textContent = textoBoton;

      if (!resultado.ok) {
        reportarFallo(
          operacionFallida(resultado),
          resultado.error || null,
          inicio,
          resultado.codigo || (resultado.ambigua ? "create_confirmation_pending" : "save_failed")
        );
        mostrarToast(resultado.mensajeUsuario, "error");
        mostrarErrorOperacion(resultado.mensajeUsuario);
        return;
      }
      borradorCurso.abandonar();
      const sufijoResultado = estadoDestino === "borrador" ? "borrador" : "";
      const resultadoQuery = [cursoId ? "actualizado" : "creado", sufijoResultado].filter(Boolean).join("_");
      /* replace, no href: el formulario ya cumplió su función, así que su
         entrada de historial no debe quedar viva para un Alt+← posterior. */
      window.location.replace(`${RUTA_CATALOGO_CURSOS}?resultado=${resultadoQuery}`);
    }
  }
})();

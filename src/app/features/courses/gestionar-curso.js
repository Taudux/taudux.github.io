/*
  Formulario reutilizable para crear o editar un curso. La presencia de un único
  `id` UUID activa edición y exige cargar ese curso; nunca degrada a creación.
  Requiere sesión y rol admin. Depende de auth, categorías, cursos y toast.
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
    };
  }

  if (typeof module === "object" && module.exports) {
    module.exports = Object.freeze({ crearDatosEnvioCurso });
    return;
  }

  const PAGINA = "course_admin_form";
  const RUTA_LISTA = "/src/app/features/courses/gestionar-cursos.html";
  const VALOR_CATEGORIA_SIN_ASIGNAR = "__sin_categoria__";
  const PREFIJO_CATEGORIA_LEGACY = "__categoria_legacy__:";
  const UUID_CURSO = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const UUID_OPERACION_CURSO = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  const startup = document.getElementById("adminStartup");
  const startupTitulo = document.getElementById("adminStartupTitle");
  const startupMensaje = document.getElementById("adminStartupMessage");
  const startupReintentar = document.getElementById("adminStartupRetry");
  const startupLoader = document.getElementById("adminStartupLoader");
  const startupLoadingMessage = document.getElementById("adminStartupLoadingMessage");
  const startupError = document.getElementById("adminStartupError");
  const navbar = document.getElementById("adminNavbar");
  const contenido = document.getElementById("adminContent");
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
  const estadoPortada = document.getElementById("cursoPortadaEstado");
  const botonEnviar = document.getElementById("cursoEnviar");
  const botonCancelar = document.getElementById("cursoCancelar");
  const estadoCategorias = document.getElementById("categoriasEstado");
  const mensajeEstadoCategorias = document.getElementById("categoriasEstadoMensaje");
  const botonReintentarCategorias = document.getElementById("categoriasReintentar");
  const estadoOperacion = document.getElementById("cursoOperacionEstado");
  const mensajeOperacion = document.getElementById("cursoOperacionMensaje");

  let cursoId = null;
  let cursoEditando = null;
  let categorias = [];
  let modoCategorias = "cargando";
  let cargaCategoriasEnCurso = false;
  let secuenciaCargaCategorias = 0;
  const flujoMutacionCurso = window.portadasCurso.crearFlujoMutacionCurso({
    subirPortada: window.portadasCurso.subir,
    crearCurso,
    actualizarCurso,
    generarOperacionId: generarIdOperacionCurso,
  });

  form.addEventListener("submit", enviarFormulario);
  form.addEventListener("input", invalidarOperacionSiCambio);
  form.addEventListener("change", invalidarOperacionSiCambio);
  botonCancelar.addEventListener("click", () => {
    window.location.href = RUTA_LISTA;
  });
  botonReintentarCategorias.addEventListener("click", reintentarCategorias);
  botonReintentarRuta.addEventListener("click", () => window.location.reload());
  startupReintentar.addEventListener("click", () => window.location.reload());
  inputProximamente.addEventListener("change", actualizarEstadoProgramacion);
  inputPortada.addEventListener("change", seleccionarPortadaLocal);

  const inicioStartup = iniciarTiempo();
  try {
    const session = await requerirSesion();
    if (!session) return;
    if (!(await esAdmin(session))) {
      window.location.href = "/src/app/features/courses/cursos.html";
      return;
    }
  } catch (error) {
    reportarFallo("admin_startup", error, inicioStartup, "startup_failed");
    mostrarErrorStartup(
      "No pudimos verificar tu acceso. Revisa tu conexión y vuelve a intentarlo."
    );
    return;
  }

  let rutaValida;
  try {
    rutaValida = await configurarModo();
  } catch (error) {
    reportarFallo("course_form_startup", error, inicioStartup, "form_startup_exception");
    mostrarErrorStartup("No se pudo preparar el formulario. Vuelve a intentarlo.");
    return;
  }
  if (!rutaValida) {
    revelarAdministracion();
    estadoRuta.focus();
    return;
  }

  try {
    await cargarCategorias();
    if (cursoEditando) poblarFormulario(cursoEditando);
    actualizarEstadoProgramacion();
    panel.hidden = false;
    revelarAdministracion();
  } catch (error) {
    reportarFallo("course_form_startup", error, inicioStartup, "form_startup_exception");
    mostrarErrorStartup("No se pudo preparar el formulario. Vuelve a intentarlo.");
    return;
  }

  function iniciarTiempo() {
    return typeof iniciarMedicionOperacion === "function"
      ? iniciarMedicionOperacion()
      : Date.now();
  }

  function reportarFallo(operacion, error, inicio, codigo) {
    if (typeof reportarErrorOperacion === "function") {
      reportarErrorOperacion({ operacion, pagina: PAGINA, error, codigo, inicio });
      return;
    }
    console.error("[gestionar-curso]", { operacion, codigo: codigo || "unknown_error" });
  }

  function mostrarErrorStartup(mensaje) {
    startup.classList.add("courses__startup-status--error");
    startupTitulo.textContent = "No se pudo abrir el formulario";
    startupMensaje.textContent = mensaje;
    startupLoader.hidden = true;
    startupLoadingMessage.hidden = true;
    startupError.hidden = false;
    startupReintentar.hidden = false;
    startup.setAttribute("aria-busy", "false");
    startup.focus();
  }

  function revelarAdministracion() {
    startup.setAttribute("aria-busy", "false");
    startup.hidden = true;
    navbar.hidden = false;
    contenido.hidden = false;
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

  function seleccionarPortadaLocal() {
    const archivo = inputPortada.files?.[0];
    if (!archivo) {
      estadoPortada.textContent = "";
      return;
    }
    estadoPortada.textContent = `Se usará el archivo ${archivo.name}.`;
  }

  function crearCategoriasLegacy(nombresExtra = []) {
    const nombres = [...CATEGORIAS_LEGACY_CURSO, ...nombresExtra]
      .map((nombre) => (typeof nombre === "string" ? nombre.trim() : ""))
      .filter(Boolean);
    return Array.from(new Map(
      nombres.map((nombre) => [nombre.toLocaleLowerCase("es-MX"), nombre])
    ).values())
      .sort((a, b) => a.localeCompare(b, "es-MX"))
      .map((nombre) => ({ id: null, nombre, activo: null, legacy: true }));
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
      ocultarEstadoCategorias();
    } else {
      if (!falloReportado) {
        reportarFallo(
          "course_form_category_load",
          null,
          inicio,
          resultado.migracionRequerida ? "migration_required" : "category_load_failed"
        );
      }
      categorias = crearCategoriasLegacy(cursoEditando?.categoria ? [cursoEditando.categoria] : []);
      if (resultado.migracionRequerida) {
        modoCategorias = "legacy";
        mostrarEstadoCategorias(
          "migration",
          "Se requiere aplicar la migración 0010 en Supabase. Puedes guardar el curso con las opciones heredadas."
        );
      } else {
        modoCategorias = modoCategorias === "normalizado" ? "normalizado" : "legacy";
        mostrarEstadoCategorias(
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

  function mostrarEstadoCategorias(tipo, mensaje) {
    estadoCategorias.hidden = false;
    estadoCategorias.classList.remove(
      "courses__categories-status--migration",
      "courses__categories-status--error"
    );
    estadoCategorias.classList.add(`courses__categories-status--${tipo}`);
    mensajeEstadoCategorias.textContent = mensaje;
  }

  function ocultarEstadoCategorias() {
    estadoCategorias.hidden = true;
    mensajeEstadoCategorias.textContent = "";
    estadoCategorias.classList.remove(
      "courses__categories-status--migration",
      "courses__categories-status--error"
    );
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
    const datos = obtenerDatosFormulario();
    const archivoPortada = inputPortada.files?.[0] || null;
    if (!inputProximamente.checked && datos.dias_semana.length === 0) {
      mostrarToast("Selecciona al menos un día de la semana.", "error");
      return;
    }

    ocultarErrorOperacion();
    const textoBoton = botonEnviar.textContent;
    const inicio = iniciarTiempo();
    const resultado = await flujoMutacionCurso.ejecutar({
      cursoId,
      datos,
      archivoPortada,
      firma: firmaSolicitud(datos, archivoPortada),
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

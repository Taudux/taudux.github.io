/*
  Administración exclusiva de categorías: alta, renombrado, activación y retiro
  seguro. Requiere sesión y rol admin; RLS sigue siendo el gate real. Depende de
  auth.service.js, categorias.service.js, telemetry/operaciones.js y toast.js.
*/

(async () => {
  const { iniciarTiempo, reportarFallo } = crearReporteroOperaciones("course_admin_categories");
  const startup = document.getElementById("adminStartup");
  const startupTitulo = document.getElementById("adminStartupTitle");
  const startupMensaje = document.getElementById("adminStartupMessage");
  const startupReintentar = document.getElementById("adminStartupRetry");
  const startupLoader = document.getElementById("adminStartupLoader");
  const startupLoadingMessage = document.getElementById("adminStartupLoadingMessage");
  const startupError = document.getElementById("adminStartupError");
  const navbar = document.getElementById("adminNavbar");
  const contenido = document.getElementById("adminContent");
  const panel = document.querySelector(".courses__categories-panel");
  const form = document.getElementById("categoriaForm");
  const inputNombre = document.getElementById("categoriaNombre");
  const botonAgregar = document.getElementById("categoriaAgregar");
  const estado = document.getElementById("categoriasEstado");
  const mensajeEstado = document.getElementById("categoriasEstadoMensaje");
  const botonReintentar = document.getElementById("categoriasReintentar");
  const lista = document.getElementById("categoriasLista");

  let categorias = [];
  let modoCategorias = "cargando";
  let cargaEnCurso = false;
  let mutacionEnCurso = false;
  let secuenciaCarga = 0;
  let controles = [];

  form.addEventListener("submit", agregarCategoria);
  botonReintentar.addEventListener("click", reintentarCategorias);
  startupReintentar.addEventListener("click", () => window.location.reload());

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

  try {
    await cargarCategorias();
    revelarAdministracion();
  } catch (error) {
    reportarFallo("category_startup", error, inicioStartup, "category_startup_exception");
    mostrarErrorStartup("No se pudieron preparar las categorías. Vuelve a intentarlo.");
    return;
  }

  function mostrarErrorStartup(mensaje) {
    startup.classList.add("courses__startup-status--error");
    startupTitulo.textContent = "No se pudo abrir la administración de categorías";
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

  function crearCategoriasLegacy() {
    return CATEGORIAS_LEGACY_CURSO
      .slice()
      .sort((a, b) => a.localeCompare(b, "es-MX"))
      .map((nombre) => ({ id: null, nombre, activo: null, legacy: true }));
  }

  async function cargarCategorias({ focoId = null } = {}) {
    const solicitud = ++secuenciaCarga;
    const habiaDatos = categorias.length > 0;
    const inicio = iniciarTiempo();
    let falloReportado = false;
    cargaEnCurso = true;
    actualizarDisponibilidad();

    let resultado;
    try {
      resultado = await listarCategorias({ incluirInactivas: true });
    } catch (error) {
      reportarFallo("category_list_load", error, inicio, "category_load_exception");
      falloReportado = true;
      resultado = { ok: false, mensaje: "No se pudieron cargar las categorías." };
    }
    if (solicitud !== secuenciaCarga) return false;

    if (resultado.ok) {
      categorias = resultado.data.map((categoria) => ({ ...categoria, legacy: false }));
      modoCategorias = "normalizado";
      ocultarEstado();
      pintarCategorias();
    } else if (resultado.migracionRequerida) {
      reportarFallo("category_list_load", null, inicio, "migration_required");
      falloReportado = true;
      modoCategorias = "migracion";
      categorias = crearCategoriasLegacy();
      pintarCategorias();
      mostrarEstado(
        "migration",
        "Se requiere aplicar la migración 0010 en Supabase. La administración de categorías queda deshabilitada hasta completarla."
      );
    } else {
      if (!falloReportado) {
        reportarFallo("category_list_load", null, inicio, "category_load_failed");
      }
      modoCategorias = "error";
      if (!habiaDatos) {
        categorias = crearCategoriasLegacy();
        pintarCategorias();
      }
      mostrarEstado(
        "error",
        "No se pudieron actualizar las categorías. Se conserva la última lista disponible; reintenta cuando tengas conexión."
      );
    }

    cargaEnCurso = false;
    actualizarDisponibilidad();
    if (focoId) restaurarFoco(focoId);
    return resultado.ok;
  }

  async function reintentarCategorias() {
    if (cargaEnCurso || mutacionEnCurso) return;
    const cargadas = await cargarCategorias();
    restaurarFoco(cargadas ? "categoriaNombre" : "categoriasEstado");
  }

  function mostrarEstado(tipo, mensaje) {
    estado.hidden = false;
    estado.classList.remove(
      "courses__categories-status--migration",
      "courses__categories-status--error"
    );
    estado.classList.add(`courses__categories-status--${tipo}`);
    mensajeEstado.textContent = mensaje;
  }

  function ocultarEstado() {
    estado.hidden = true;
    mensajeEstado.textContent = "";
    estado.classList.remove(
      "courses__categories-status--migration",
      "courses__categories-status--error"
    );
  }

  function actualizarDisponibilidad() {
    const ocupada = cargaEnCurso || mutacionEnCurso;
    const bloquearCrud = ocupada || modoCategorias !== "normalizado";
    panel.classList.toggle("courses__categories-panel--busy", ocupada);
    lista.setAttribute("aria-busy", String(ocupada));
    [inputNombre, botonAgregar, ...controles].forEach((control) => {
      control.disabled = bloquearCrud;
    });
    botonReintentar.disabled = ocupada;
  }

  function pintarCategorias() {
    lista.textContent = "";
    controles = [];
    if (categorias.length === 0) {
      const vacio = document.createElement("li");
      vacio.className = "courses__category-empty";
      vacio.textContent = "Aún no hay categorías. Puedes publicar cursos sin categoría.";
      lista.appendChild(vacio);
      actualizarDisponibilidad();
      return;
    }

    categorias.forEach((categoria, indice) => {
      const item = document.createElement("li");
      item.className = "courses__category-item";
      const detalles = document.createElement("div");
      detalles.className = "courses__category-details";
      const grupo = document.createElement("div");
      grupo.className = "courses__field-group";
      const clave = categoria.id || `legacy-${indice}`;
      const idCampo = `categoria-${clave}`;
      const etiqueta = document.createElement("label");
      etiqueta.className = "courses__field-label";
      etiqueta.htmlFor = idCampo;
      etiqueta.textContent = categoria.legacy ? "Categoría heredada" : "Nombre de categoría";
      const nombre = document.createElement("input");
      nombre.className = "field";
      nombre.id = idCampo;
      nombre.type = "text";
      nombre.maxLength = LONGITUD_MAXIMA_CATEGORIA;
      nombre.value = categoria.nombre;
      grupo.append(etiqueta, nombre);
      controles.push(nombre);

      const indicador = document.createElement("span");
      indicador.className = "courses__category-status";
      if (categoria.legacy) {
        indicador.textContent = modoCategorias === "migracion"
          ? "Opción heredada"
          : "Estado sin verificar";
      } else {
        if (!categoria.activo) indicador.classList.add("courses__category-status--inactive");
        indicador.textContent = categoria.activo ? "Activa" : "Inactiva";
      }
      detalles.append(grupo, indicador);

      const acciones = document.createElement("div");
      acciones.className = "courses__category-actions";
      if (!categoria.legacy) {
        const renombrar = crearBoton("Renombrar", categoria, "renombrar");
        renombrar.addEventListener("click", () => guardarNombre(categoria, nombre, renombrar));
        const cambiarEstado = crearBoton(
          categoria.activo ? "Desactivar" : "Reactivar",
          categoria,
          "estado"
        );
        cambiarEstado.addEventListener("click", () => cambiarEstadoCategoria(categoria));
        const retirar = crearBoton("Retirar", categoria, "retirar", true);
        retirar.addEventListener("click", () => confirmarRetiro(categoria, retirar));
        acciones.append(renombrar, cambiarEstado, retirar);
        controles.push(renombrar, cambiarEstado, retirar);
      }

      item.append(detalles, acciones);
      lista.appendChild(item);
    });
    actualizarDisponibilidad();
  }

  function crearBoton(texto, categoria, accion, destructivo = false) {
    const boton = document.createElement("button");
    boton.className = "button courses__category-action";
    if (destructivo) boton.classList.add("courses__category-action--danger");
    boton.id = `categoria-${accion}-${categoria.id}`;
    boton.type = "button";
    boton.textContent = texto;
    boton.setAttribute("aria-label", `${texto} categoría ${categoria.nombre}`);
    return boton;
  }

  function iniciarMutacion() {
    if (mutacionEnCurso || cargaEnCurso || modoCategorias !== "normalizado") return false;
    mutacionEnCurso = true;
    actualizarDisponibilidad();
    return true;
  }

  function finalizarMutacion(focoId) {
    mutacionEnCurso = false;
    actualizarDisponibilidad();
    restaurarFoco(focoId);
  }

  function restaurarFoco(id) {
    const destino = document.getElementById(id) || inputNombre;
    destino.focus();
  }

  async function agregarCategoria(evento) {
    evento.preventDefault();
    if (!iniciarMutacion()) return;
    const inicio = iniciarTiempo();
    let focoId = "categoriaNombre";
    try {
      const resultado = await crearCategoria(inputNombre.value);
      if (!resultado.ok) {
        reportarFallo(
          "category_create",
          null,
          inicio,
          resultado.migracionRequerida ? "migration_required" : "category_create_failed"
        );
        mostrarToast(resultado.mensaje, "error");
        if (resultado.migracionRequerida) await cargarCategorias();
        return;
      }
      form.reset();
      mostrarToast("Categoría agregada.", "success");
      focoId = `categoria-${resultado.data.id}`;
      await cargarCategorias();
    } catch (error) {
      reportarFallo("category_create", error, inicio, "category_create_exception");
      mostrarToast("No se pudo crear la categoría.", "error");
    } finally {
      finalizarMutacion(focoId);
    }
  }

  async function guardarNombre(categoria, input, boton) {
    if (!iniciarMutacion()) return;
    const inicio = iniciarTiempo();
    let focoId = boton.id;
    try {
      const resultado = await renombrarCategoria(categoria.id, input.value);
      if (!resultado.ok) {
        reportarFallo(
          "category_rename",
          null,
          inicio,
          resultado.migracionRequerida ? "migration_required" : "category_rename_failed"
        );
        mostrarToast(resultado.mensaje, "error");
        if (resultado.migracionRequerida) await cargarCategorias();
        return;
      }
      mostrarToast("Categoría renombrada.", "success");
      focoId = `categoria-${categoria.id}`;
      await cargarCategorias();
    } catch (error) {
      reportarFallo("category_rename", error, inicio, "category_rename_exception");
      mostrarToast("No se pudo renombrar la categoría.", "error");
    } finally {
      finalizarMutacion(focoId);
    }
  }

  async function cambiarEstadoCategoria(categoria) {
    if (categoria.activo && !window.confirm(
      `¿Desactivar la categoría "${categoria.nombre}" para cursos nuevos?`
    )) return;
    if (!iniciarMutacion()) return;
    const inicio = iniciarTiempo();
    try {
      const resultado = await establecerCategoriaActiva(categoria.id, !categoria.activo);
      if (!resultado.ok) {
        reportarFallo(
          "category_status_change",
          null,
          inicio,
          resultado.migracionRequerida ? "migration_required" : "category_status_failed"
        );
        mostrarToast(resultado.mensaje, "error");
        if (resultado.migracionRequerida) await cargarCategorias();
        return;
      }
      mostrarToast(
        categoria.activo ? "Categoría desactivada." : "Categoría reactivada.",
        "success"
      );
      await cargarCategorias();
    } catch (error) {
      reportarFallo(
        "category_status_change",
        error,
        inicio,
        "category_status_exception"
      );
      mostrarToast("No se pudo cambiar el estado de la categoría.", "error");
    } finally {
      finalizarMutacion(`categoria-estado-${categoria.id}`);
    }
  }

  async function confirmarRetiro(categoria, boton) {
    const confirmar = window.confirm(
      `¿Retirar la categoría "${categoria.nombre}"? Si algún curso la usa, se desactivará; si no, se eliminará definitivamente.`
    );
    if (!confirmar || !iniciarMutacion()) return;
    const inicio = iniciarTiempo();
    let focoId = boton.id;
    try {
      const resultado = await retirarCategoria(categoria.id);
      if (!resultado.ok) {
        reportarFallo(
          "category_remove",
          null,
          inicio,
          resultado.migracionRequerida ? "migration_required" : "category_remove_failed"
        );
        mostrarToast(resultado.mensaje, "error");
        if (resultado.migracionRequerida) await cargarCategorias();
        return;
      }
      if (resultado.accion === "eliminada") {
        mostrarToast("Categoría sin cursos eliminada.", "success");
        focoId = "categoriaNombre";
      } else {
        const cantidad = resultado.referenciasExactas
          ? `${resultado.referencias} curso${resultado.referencias === 1 ? "" : "s"}`
          : `al menos ${resultado.referencias} curso`;
        mostrarToast(`Categoría en uso desactivada (${cantidad}).`, "success");
        focoId = `categoria-estado-${categoria.id}`;
      }
      await cargarCategorias();
    } catch (error) {
      reportarFallo("category_remove", error, inicio, "category_remove_exception");
      mostrarToast("No se pudo retirar la categoría.", "error");
    } finally {
      finalizarMutacion(focoId);
    }
  }
})();

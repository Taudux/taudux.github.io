/*
  Lista administrativa de cursos. Solo muestra cursos y permite navegar a su
  edición o eliminarlos. Requiere sesión y rol admin; RLS sigue siendo el gate real.
  Depende de auth.service.js, cursos.service.js y toast.js (cargar antes).
*/

(async () => {
  const PAGINA = "course_admin_list";
  const startup = document.getElementById("adminStartup");
  const startupTitulo = document.getElementById("adminStartupTitle");
  const startupMensaje = document.getElementById("adminStartupMessage");
  const startupReintentar = document.getElementById("adminStartupRetry");
  const startupLoader = document.getElementById("adminStartupLoader");
  const startupLoadingMessage = document.getElementById("adminStartupLoadingMessage");
  const startupError = document.getElementById("adminStartupError");
  const navbar = document.getElementById("adminNavbar");
  const contenido = document.getElementById("adminContent");
  const lista = document.getElementById("cursosLista");
  const estado = document.getElementById("cursosEstado");
  const mensajeEstado = document.getElementById("cursosEstadoMensaje");
  const botonReintentar = document.getElementById("cursosReintentar");
  const eliminacionesEnCurso = new Set();

  startupReintentar.addEventListener("click", () => window.location.reload());
  botonReintentar.addEventListener("click", reintentarCursos);

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

  let cursosCargados;
  try {
    cursosCargados = await pintarCursos();
  } catch (error) {
    reportarFallo("course_list_startup", error, inicioStartup, "list_startup_exception");
    mostrarErrorStartup("No se pudo preparar la lista de cursos. Vuelve a intentarlo.");
    return;
  }
  revelarAdministracion();
  if (!cursosCargados) estado.focus();
  mostrarResultadoGuardado();

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
    console.error("[gestionar-cursos]", { operacion, codigo: codigo || "unknown_error" });
  }

  function mostrarErrorStartup(mensaje) {
    startup.classList.add("courses__startup-status--error");
    startupTitulo.textContent = "No se pudo abrir la administración";
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

  function mostrarResultadoGuardado() {
    const url = new URL(window.location.href);
    const resultado = url.searchParams.get("resultado");
    if (resultado === "creado") mostrarToast("Curso publicado.", "success");
    if (resultado === "actualizado") mostrarToast("Curso actualizado.", "success");
    if (resultado) {
      url.searchParams.delete("resultado");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }

  async function reintentarCursos() {
    const cargados = await pintarCursos();
    (cargados ? lista : estado).focus();
  }

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
    estado.classList.remove("courses__data-status--error");
    mensajeEstado.textContent = "";
    lista.textContent = "";
    if (resultado.data.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "courses__empty";
      vacio.textContent = "Aún no hay cursos publicados.";
      lista.appendChild(vacio);
      return true;
    }
    resultado.data.forEach((curso) => lista.appendChild(crearTarjetaGestion(curso)));
    return true;
  }

  function mostrarErrorLista(mensaje) {
    estado.hidden = false;
    estado.classList.add("courses__data-status--error");
    mensajeEstado.textContent = mensaje;
  }

  function crearTarjetaGestion(curso) {
    const tarjeta = document.createElement("article");
    tarjeta.className = "courses__card panel";

    if (curso.imagen_url && esUrlSegura(curso.imagen_url)) {
      const imagen = document.createElement("img");
      imagen.className = "courses__card-image";
      imagen.src = curso.imagen_url;
      imagen.alt = curso.titulo ? `Imagen del curso: ${curso.titulo}` : "Imagen del curso";
      tarjeta.appendChild(imagen);
    }

    agregarBadge(tarjeta, etiquetaModalidad(curso), curso.modalidad);
    agregarBadge(tarjeta, curso.categoria, "categoria");
    if (curso.proximamente) agregarBadge(tarjeta, "Próximamente", "proximamente");

    const titulo = document.createElement("h2");
    titulo.className = "courses__card-title";
    titulo.textContent = curso.titulo;
    tarjeta.appendChild(titulo);

    if (!curso.proximamente) {
      agregarTexto(tarjeta, formatearHorario(curso), "courses__card-meta");
      agregarTexto(tarjeta, formatearRangoFechas(curso), "courses__card-dates");
    }
    agregarTexto(
      tarjeta,
      curso.instructor ? `Imparte: ${curso.instructor}` : null,
      "courses__card-instructor"
    );
    const extra = [
      curso.cupo_maximo ? `Cupo: ${curso.cupo_maximo}` : null,
      formatearCosto(curso.costo),
    ].filter(Boolean).join(" · ");
    agregarTexto(tarjeta, extra, "courses__card-extra");
    agregarTexto(tarjeta, curso.descripcion, "courses__card-description");

    const acciones = document.createElement("div");
    acciones.className = "courses__card-admin";

    const editar = document.createElement("a");
    editar.className = "button courses__action";
    editar.href = `/src/app/features/courses/gestionar-curso.html?id=${encodeURIComponent(curso.id)}`;
    editar.textContent = "Editar";

    const eliminar = document.createElement("button");
    eliminar.className = "button courses__action courses__action--danger";
    eliminar.type = "button";
    eliminar.textContent = "Eliminar";
    eliminar.addEventListener("click", () => borrarCurso(curso, eliminar));

    acciones.append(editar, eliminar);
    tarjeta.appendChild(acciones);
    return tarjeta;
  }

  function agregarBadge(tarjeta, texto, modificador) {
    if (!texto) return;
    const badge = document.createElement("span");
    badge.className = `courses__badge courses__badge--${modificador}`;
    badge.textContent = texto;
    tarjeta.appendChild(badge);
  }

  function agregarTexto(tarjeta, texto, clase) {
    if (!texto) return;
    const elemento = document.createElement("p");
    elemento.className = clase;
    elemento.textContent = texto;
    tarjeta.appendChild(elemento);
  }

  async function borrarCurso(curso, boton) {
    if (eliminacionesEnCurso.has(curso.id)) return;
    if (!window.confirm(`¿Eliminar "${curso.titulo}"?`)) return;

    eliminacionesEnCurso.add(curso.id);
    boton.disabled = true;
    const inicio = iniciarTiempo();
    try {
      const resultado = await eliminarCurso(curso.id);
      if (!resultado.ok) {
        reportarFallo("course_delete", null, inicio, resultado.codigo || "delete_failed");
        mostrarErrorLista(resultado.mensaje || "No se pudo eliminar el curso.");
        estado.focus();
        return;
      }
      mostrarToast("Curso eliminado.", "success");
      retirarTarjetaEliminada(boton);
      await pintarCursos();
    } catch (error) {
      reportarFallo("course_delete", error, inicio, "delete_exception");
      mostrarErrorLista("No se pudo eliminar el curso. Puedes volver a intentarlo.");
      estado.focus();
    } finally {
      eliminacionesEnCurso.delete(curso.id);
      boton.disabled = false;
    }
  }

  function retirarTarjetaEliminada(boton) {
    const tarjeta = typeof boton.closest === "function" ? boton.closest(".courses__card") : null;
    if (tarjeta) tarjeta.remove();
    if (lista.childElementCount > 0) return;
    const vacio = document.createElement("p");
    vacio.className = "courses__empty";
    vacio.textContent = "Aún no hay cursos publicados.";
    lista.appendChild(vacio);
  }
})();

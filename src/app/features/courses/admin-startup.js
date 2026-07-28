/*
  Arranque compartido de las pantallas de administración de cursos. Ambas usan el
  mismo markup (#adminStartup, #adminNavbar, #adminContent) y la misma secuencia:
  exigir sesión, exigir rol admin, y solo entonces revelar el contenido.

  El gate real de escritura es la RLS de Postgres; esto es la puerta de UX.
  Depende de auth.service.js y telemetry/operaciones.js.
*/

const RUTA_CATALOGO_CURSOS = "/src/app/features/courses/cursos.html";

function crearArranqueAdmin({ pagina, tituloError }) {
  const { iniciarTiempo, reportarFallo } = crearReporteroOperaciones(pagina);
  const startup = document.getElementById("adminStartup");
  const titulo = document.getElementById("adminStartupTitle");
  const mensajeError = document.getElementById("adminStartupMessage");
  const reintentar = document.getElementById("adminStartupRetry");
  const loader = document.getElementById("adminStartupLoader");
  const mensajeCarga = document.getElementById("adminStartupLoadingMessage");
  const bloqueError = document.getElementById("adminStartupError");
  const navbar = document.getElementById("adminNavbar");
  const contenido = document.getElementById("adminContent");

  reintentar.addEventListener("click", () => window.location.reload());

  function mostrarError(mensaje) {
    startup.classList.add("courses__startup-status--error");
    titulo.textContent = tituloError;
    mensajeError.textContent = mensaje;
    loader.hidden = true;
    mensajeCarga.hidden = true;
    bloqueError.hidden = false;
    reintentar.hidden = false;
    startup.setAttribute("aria-busy", "false");
    startup.focus();
  }

  function revelar() {
    startup.setAttribute("aria-busy", "false");
    startup.hidden = true;
    navbar.hidden = false;
    contenido.hidden = false;
  }

  /*
    Devuelve true solo si la pantalla puede continuar. Sin sesión, requerirSesion
    ya navegó al login; sin rol admin, mandamos al catálogo. En ambos casos el
    llamador debe abandonar sin revelar nada.
  */
  async function asegurarAdmin(inicio) {
    try {
      const session = await requerirSesion();
      if (!session) return false;
      if (await esAdmin(session)) return true;
      window.location.href = RUTA_CATALOGO_CURSOS;
      return false;
    } catch (error) {
      reportarFallo("admin_startup", error, inicio, "startup_failed");
      mostrarError("No pudimos verificar tu acceso. Revisa tu conexión y vuelve a intentarlo.");
      return false;
    }
  }

  return Object.freeze({ iniciarTiempo, reportarFallo, asegurarAdmin, mostrarError, revelar });
}

/*
  Panel de estado de categorías, compartido por el formulario de curso y la
  pantalla de categorías. `tipo` es "migration" o "error".
*/
function crearPanelEstadoCategorias(panel, mensaje) {
  const MODIFICADORES = ["courses__categories-status--migration", "courses__categories-status--error"];

  return Object.freeze({
    mostrar(tipo, texto) {
      panel.hidden = false;
      panel.classList.remove(...MODIFICADORES);
      panel.classList.add(`courses__categories-status--${tipo}`);
      mensaje.textContent = texto;
    },
    ocultar() {
      panel.hidden = true;
      mensaje.textContent = "";
      panel.classList.remove(...MODIFICADORES);
    },
  });
}

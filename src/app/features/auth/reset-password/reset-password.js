/* Validación del enlace de recuperación y cambio de contraseña. */

const resetLoading = document.getElementById("resetLoading");
const resetContent = document.getElementById("resetContent");
const resetForm = document.getElementById("resetForm");
const resetPassword = document.getElementById("resetPassword");
const resetPasswordConfirm = document.getElementById("resetPasswordConfirm");
const passwordReqs = document.getElementById("passwordReqs");
const requestNewLink = document.getElementById("requestNewLink");

configurarRequisitosContrasena(resetPassword, passwordReqs);

function mostrarContenidoReset() {
  resetLoading.hidden = true;
  resetContent.hidden = false;
}

async function esperarSesionRecuperacion() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const esFragmentoRecuperacion = hash.get("type") === "recovery";
  const esCodigoRecuperacion = query.has("code");
  const pareceRecuperacion = esFragmentoRecuperacion || esCodigoRecuperacion;
  if (!pareceRecuperacion) return null;

  let resolverSesion;
  const sesionRecuperada = new Promise((resolve) => {
    resolverSesion = resolve;
  });
  const { data } = supabaseClient.auth.onAuthStateChange((evento, session) => {
    if (evento === "PASSWORD_RECOVERY" && session) resolverSesion(session);
  });

  try {
    const sessionExistente = await obtenerSesion();
    if (esFragmentoRecuperacion && sessionExistente) return sessionExistente;

    return await Promise.race([
      sesionRecuperada,
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
  } finally {
    data.subscription.unsubscribe();
  }
}

async function inicializarReset() {
  const errorEnlace = parametrosErrorAuth();
  if (errorEnlace) {
    mostrarContenidoReset();
    requestNewLink.hidden = false;
    mostrarEstadoAuth(mensajeErrorEnlace(errorEnlace), "error");
    return;
  }

  const session = await esperarSesionRecuperacion();
  mostrarContenidoReset();
  if (!session) {
    requestNewLink.hidden = false;
    mostrarEstadoAuth("El enlace de recuperación no es válido o expiró.", "error");
    return;
  }

  resetForm.hidden = false;
  resetPassword.focus();
}

resetForm.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (formularioEstaOcupado(resetForm)) return;
  ocultarEstadoAuth();

  if (!resetForm.checkValidity()) {
    resetForm.reportValidity();
    return;
  }

  if (!contrasenaValida(resetPassword.value)) {
    resetPassword.focus();
    mostrarEstadoAuth(
      "La contraseña no cumple los requisitos de seguridad.",
      "error",
      true,
      [resetPassword]
    );
    return;
  }

  if (resetPassword.value !== resetPasswordConfirm.value) {
    resetPasswordConfirm.focus();
    mostrarEstadoAuth("Las contraseñas no coinciden.", "error", true, [resetPasswordConfirm]);
    return;
  }

  establecerFormularioOcupado(resetForm, true);
  try {
    const cambio = await cambiarContrasena(resetPassword.value);
    if (!cambio.ok) {
      mostrarEstadoAuth(cambio.mensaje, "error", true, [resetPassword]);
      return;
    }

    const cierre = await cerrarSesion();
    if (!cierre.ok) {
      mostrarEstadoAuth(
        "La contraseña cambió, pero no pudimos cerrar todas las sesiones. Intenta cerrar sesión nuevamente.",
        "error"
      );
      return;
    }

    history.replaceState(null, "", window.location.pathname);
    window.location.replace(`${RUTAS_AUTH.login}?password-reset=1`);
  } finally {
    establecerFormularioOcupado(resetForm, false);
  }
});

inicializarReset();

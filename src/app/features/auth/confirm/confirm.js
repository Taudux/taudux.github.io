/* Pantalla de espera y callback de confirmación de correo. */

const confirmLoading = document.getElementById("confirmLoading");
const confirmContent = document.getElementById("confirmContent");
const resendForm = document.getElementById("resendForm");
const confirmEmail = document.getElementById("confirmEmail");

confirmEmail.value = obtenerEmailConfirmacion();

function mostrarContenidoConfirmacion() {
  confirmLoading.hidden = true;
  confirmContent.hidden = false;
}

async function esperarSesionConfirmacion(esFragmento, esCodigo) {
  let resolverSesion;
  const sesionDetectada = new Promise((resolve) => {
    resolverSesion = resolve;
  });
  const { data } = supabaseClient.auth.onAuthStateChange((evento, session) => {
    if (session && ["SIGNED_IN", "TOKEN_REFRESHED"].includes(evento)) {
      resolverSesion(session);
    }
  });

  try {
    const sessionExistente = await obtenerSesion();
    if (esFragmento && sessionExistente) return sessionExistente;
    if (!esCodigo && sessionExistente) return sessionExistente;

    return await Promise.race([
      sesionDetectada,
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
  } finally {
    data.subscription.unsubscribe();
  }
}

async function procesarConfirmacion() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const errorEnlace = parametrosErrorAuth();
  const esFragmento = hash.has("access_token") || hash.get("type") === "signup";
  const esCodigo = query.has("code");
  const esCallback = esFragmento || esCodigo;

  if (errorEnlace) {
    mostrarContenidoConfirmacion();
    mostrarEstadoAuth(mensajeErrorEnlace(errorEnlace), "error");
    return;
  }

  if (!esCallback) {
    mostrarContenidoConfirmacion();
    if (confirmEmail.value) confirmEmail.focus();
    return;
  }

  const session = await esperarSesionConfirmacion(esFragmento, esCodigo);
  if (!session) {
    mostrarContenidoConfirmacion();
    mostrarEstadoAuth("No pudimos validar el enlace. Solicita una confirmación nueva.", "error");
    return;
  }

  const cierre = await cerrarSesion({ scope: "local" });
  if (!cierre.ok) {
    mostrarContenidoConfirmacion();
    mostrarEstadoAuth(
      "El correo quedó confirmado, pero no pudimos cerrar la sesión temporal. Intenta nuevamente.",
      "error"
    );
    return;
  }

  limpiarEmailConfirmacion();
  window.location.replace(`${RUTAS_AUTH.login}?confirmed=1`);
}

resendForm.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (formularioEstaOcupado(resendForm)) return;
  ocultarEstadoAuth();

  if (!resendForm.checkValidity()) {
    resendForm.reportValidity();
    return;
  }

  const email = confirmEmail.value.trim();
  establecerFormularioOcupado(resendForm, true);
  try {
    const resultado = await reenviarConfirmacion(email);
    if (resultado.ok) guardarEmailConfirmacion(email);
    mostrarEstadoAuth(
      resultado.ok
        ? "Si la cuenta está pendiente, recibirás un nuevo correo de confirmación."
        : resultado.mensaje,
      resultado.ok ? "success" : "error",
      true,
      resultado.ok ? [] : [confirmEmail]
    );
  } finally {
    establecerFormularioOcupado(resendForm, false);
  }
});

procesarConfirmacion();

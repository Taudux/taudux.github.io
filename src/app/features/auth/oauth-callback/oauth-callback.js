/*
  Aterrizaje del handshake OAuth (Google, PKCE). El cliente canjea el
  `?code=` por su cuenta al crearse (detectSessionInUrl: true, default de
  supabase-js) — acá solo se espera el resultado y se decide el destino.
  Llamar exchangeCodeForSession de nuevo generaría una carrera con ese canje
  automático y fallaría con flow_state_not_found.
*/

const oauthLoading = document.getElementById("oauthLoading");
const oauthActions = document.getElementById("oauthActions");
const ESPERA_MAXIMA_MS = 8000;

function mostrarFalloOauth(mensaje) {
  oauthLoading.hidden = true;
  oauthActions.hidden = false;
  mostrarEstadoAuth(mensaje, "error");
}

async function esperarSesionOauth() {
  const sesionExistente = await obtenerSesion();
  if (sesionExistente) return sesionExistente;

  let resolverSesion;
  const sesionDetectada = new Promise((resolve) => {
    resolverSesion = resolve;
  });
  const { data } = supabaseClient.auth.onAuthStateChange((evento, session) => {
    if (session && evento === "SIGNED_IN") resolverSesion(session);
  });

  try {
    return await Promise.race([
      sesionDetectada,
      new Promise((resolve) => setTimeout(() => resolve(null), ESPERA_MAXIMA_MS)),
    ]);
  } finally {
    data.subscription.unsubscribe();
  }
}

async function procesarCallbackOauth() {
  // El proveedor devuelve la cancelación/rechazo como error_code en el query.
  const errorEnlace = parametrosErrorAuth();
  if (errorEnlace) {
    const cancelado =
      errorEnlace.codigo === "access_denied" || /access_denied/.test(errorEnlace.descripcion || "");
    mostrarFalloOauth(
      cancelado
        ? "Cancelaste el acceso con Google. Puedes intentarlo de nuevo o usar tu correo y contraseña."
        : mensajeErrorEnlace(errorEnlace)
    );
    return;
  }

  if (!new URLSearchParams(window.location.search).has("code")) {
    window.location.replace(RUTAS_AUTH.login);
    return;
  }

  const session = await esperarSesionOauth();
  if (!session) {
    mostrarFalloOauth("No pudimos completar el acceso con Google. Intenta de nuevo.");
    return;
  }

  const destino = destinoDespuesDeAuth();
  limpiarDestinoAuth();
  // Saca el ?code= del historial antes de navegar al destino final.
  history.replaceState(null, "", window.location.pathname);
  window.location.replace(destino);
}

procesarCallbackOauth();

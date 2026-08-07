/*
  Servicio de autenticación: único acceso a Supabase Auth y a la tabla perfiles.
  Depende de supabaseClient (core/supabase/supabase-client.js).
*/

const RUTAS_AUTH = Object.freeze({
  login: "/app/features/auth/login/",
  signup: "/app/features/auth/signup/",
  confirm: "/app/features/auth/confirm/",
  forgotPassword: "/app/features/auth/forgot-password/",
  resetPassword: "/app/features/auth/reset-password/",
  oauthCallback: "/app/features/auth/oauth-callback/",
});

const CLAVE_DESTINO_AUTH = "taudux_auth_next";
const DESTINO_AUTH_VIGENCIA_MS = 24 * 60 * 60 * 1000;

// Los códigos son un contrato estable de Supabase; los mensajes pueden cambiar.
function traducirErrorAuth(error) {
  const codigo = error?.code || "";
  const mensajes = {
    invalid_credentials: "Correo o contraseña incorrectos.",
    email_not_confirmed:
      "Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.",
    email_address_invalid: "Ese correo no parece válido.",
    email_address_not_authorized: "No fue posible enviar un correo a esa dirección.",
    email_exists: "No fue posible completar el registro con ese correo.",
    user_already_exists: "No fue posible completar el registro con ese correo.",
    weak_password: "La contraseña no cumple los requisitos de seguridad.",
    over_email_send_rate_limit:
      "Ya se envió un correo recientemente. Espera un momento antes de intentarlo otra vez.",
    over_request_rate_limit:
      "Demasiados intentos. Espera unos minutos antes de volver a intentarlo.",
    signup_disabled: "El registro de nuevas cuentas no está disponible en este momento.",
    email_provider_disabled: "El acceso con correo no está disponible en este momento.",
    provider_disabled: "El acceso con Google no está disponible en este momento.",
    oauth_provider_not_supported: "El acceso con Google no está disponible en este momento.",
    identity_already_exists: "Esa cuenta de Google ya está vinculada a otro usuario.",
    otp_expired: "El enlace expiró o ya fue utilizado. Solicita uno nuevo.",
    flow_state_expired: "El enlace expiró. Solicita uno nuevo.",
    flow_state_not_found: "El enlace ya no es válido. Solicita uno nuevo.",
    session_expired: "La sesión expiró. Inicia el proceso nuevamente.",
    session_not_found: "La sesión ya no es válida. Inicia el proceso nuevamente.",
    same_password: "La nueva contraseña debe ser diferente de la anterior.",
  };

  if (mensajes[codigo]) return mensajes[codigo];
  if (error?.status === 429) {
    return "Demasiados intentos. Espera unos minutos antes de volver a intentarlo.";
  }
  return "Ocurrió un error. Intenta de nuevo en unos momentos.";
}

function urlAbsolutaAuth(ruta) {
  return `${window.location.origin}${ruta}`;
}

// Solo acepta rutas absolutas del mismo origen y nunca devuelve a otra pantalla de auth.
function validarDestinoInterno(valor) {
  if (!valor || !valor.startsWith("/")) return null;

  try {
    const url = new URL(valor, window.location.origin);
    const baseAuth = "/app/features/auth/";
    if (url.origin !== window.location.origin || url.pathname.startsWith(baseAuth)) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function guardarDestinoAuth(destino) {
  const ruta = validarDestinoInterno(destino);
  if (!ruta) return null;

  try {
    localStorage.setItem(
      CLAVE_DESTINO_AUTH,
      JSON.stringify({ ruta, guardadoEn: Date.now() })
    );
  } catch {
    return ruta;
  }
  return ruta;
}

function obtenerDestinoAuth() {
  const destinoConsulta = validarDestinoInterno(
    new URLSearchParams(window.location.search).get("next")
  );
  if (destinoConsulta) return guardarDestinoAuth(destinoConsulta);

  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_DESTINO_AUTH));
    if (
      !guardado ||
      Date.now() - guardado.guardadoEn > DESTINO_AUTH_VIGENCIA_MS
    ) {
      localStorage.removeItem(CLAVE_DESTINO_AUTH);
      return null;
    }
    return validarDestinoInterno(guardado.ruta);
  } catch {
    return null;
  }
}

function limpiarDestinoAuth() {
  try {
    localStorage.removeItem(CLAVE_DESTINO_AUTH);
  } catch {
    // El destino es una mejora de navegación; auth no debe fallar si storage está bloqueado.
  }
}

function urlLoginConDestino(destino) {
  const ruta = validarDestinoInterno(destino);
  if (!ruta) return RUTAS_AUTH.login;
  return `${RUTAS_AUTH.login}?next=${encodeURIComponent(ruta)}`;
}

// Registrar un usuario. Con Confirm Email activo, data.session debe ser null.
async function registrarUsuario(email, password, nombre, apellidos, telefono) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: { nombre, apellidos, telefono },
      emailRedirectTo: urlAbsolutaAuth(RUTAS_AUTH.confirm),
    },
  });
  if (error) {
    if (["email_exists", "user_already_exists"].includes(error.code)) {
      return { ok: true, data: null, registroNeutral: true };
    }
    return {
      ok: false,
      codigo: error.code,
      mensaje: traducirErrorAuth(error),
    };
  }

  // Defensa ante una futura desconfiguración de Confirm Email. La pantalla de
  // confirmación repite este cierre antes de permitir continuar.
  if (data.session) {
    const cierre = await cerrarSesion({ scope: "local" });
    if (!cierre.ok) {
      return {
        ok: false,
        codigo: cierre.codigo,
        mensaje:
          "La cuenta se creó, pero no pudimos cerrar la sesión temporal. Cierra esta pestaña antes de continuar.",
      };
    }
  }

  return { ok: true, data };
}

async function iniciarSesion(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    return {
      ok: false,
      codigo: error.code,
      mensaje: traducirErrorAuth(error),
      noConfirmado: error.code === "email_not_confirmed",
    };
  }
  return { ok: true, data };
}

// Sin scopes explícitos: el default (openid email profile) ya es el mínimo
// necesario. Sin access_type/prompt de consentimiento: no hay backend que
// use el refresh token de Google, Supabase emite el suyo. Sin
// skipBrowserRedirect: el default navega en la misma pestaña, que es lo que
// preserva el code_verifier de PKCE guardado en sessionStorage.
async function iniciarSesionConGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: urlAbsolutaAuth(RUTAS_AUTH.oauthCallback),
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) {
    return { ok: false, codigo: error.code, mensaje: traducirErrorAuth(error) };
  }
  return { ok: true };
}

async function cerrarSesion({ scope = "global" } = {}) {
  const { error } = await supabaseClient.auth.signOut({ scope });
  if (error) {
    return { ok: false, codigo: error.code, mensaje: traducirErrorAuth(error) };
  }
  return { ok: true };
}

/*
  Borra la cuenta del usuario de la sesión actual. El id a borrar nunca viaja en
  el cuerpo: la edge function lo toma del JWT, así que esta llamada no puede
  apuntar a otra cuenta. Un solo mensaje de error porque no hay casos de negocio
  que el usuario pueda distinguir ni resolver de manera distinta.
*/
async function eliminarCuenta() {
  const { data, error } = await supabaseClient.functions.invoke("delete-account", { body: {} });
  if (error || data?.ok !== true) {
    return {
      ok: false,
      mensaje: "No pudimos eliminar tu cuenta. Intenta de nuevo en unos momentos.",
    };
  }
  return { ok: true };
}

async function recuperarContrasena(email) {
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: urlAbsolutaAuth(RUTAS_AUTH.resetPassword),
  });
  if (error) {
    return { ok: false, codigo: error.code, mensaje: traducirErrorAuth(error) };
  }
  return { ok: true };
}

async function reenviarConfirmacion(email) {
  const { error } = await supabaseClient.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: urlAbsolutaAuth(RUTAS_AUTH.confirm) },
  });
  if (error) {
    return { ok: false, codigo: error.code, mensaje: traducirErrorAuth(error) };
  }
  return { ok: true };
}

// Los enlaces de correo llegan con token_hash: verifyOtp no depende del
// code_verifier, así que el correo se puede abrir en cualquier navegador o
// dispositivo distinto del que originó el pedido.
async function verificarEnlaceCorreo(tokenHash, tipo) {
  const { data, error } = await supabaseClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: tipo,
  });
  if (error) {
    return { ok: false, codigo: error.code, mensaje: traducirErrorAuth(error) };
  }
  return { ok: true, data };
}

/*
  data.tiene_contrasena queda en user_metadata porque identities NO se
  actualiza acá: Supabase sólo agrega una identidad "email" al hacer signUp o
  al vincular un proveedor explícitamente, nunca al llamar updateUser con
  password sobre una cuenta OAuth-only. Sin esta marca, una cuenta Google que
  recién creó su contraseña seguiría viéndose "sin contraseña" para siempre
  (ver auth-identidades.js), porque identities seguiría listando sólo google.
*/
async function cambiarContrasena(nuevaPassword) {
  const { error } = await supabaseClient.auth.updateUser({
    password: nuevaPassword,
    data: { tiene_contrasena: true },
  });
  if (error) {
    return { ok: false, codigo: error.code, mensaje: traducirErrorAuth(error) };
  }
  return { ok: true };
}

async function obtenerSesion() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) return null;
  return data.session;
}

async function requerirSesion() {
  const session = await obtenerSesion();
  if (!session) {
    const destino = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.href = urlLoginConDestino(destino);
    return null;
  }
  return session;
}

async function obtenerPerfil(session) {
  if (!session?.user?.id) return null;

  const { data, error } = await supabaseClient
    .from("perfiles")
    .select("nombre, apellidos, telefono, rol, avisos_curso_nuevo")
    .eq("id", session.user.id)
    .single();
  if (error) return null;
  return data;
}

async function esAdmin(session) {
  const perfil = await obtenerPerfil(session);
  return perfil?.rol === "admin";
}

async function nombreUsuario(session) {
  const perfil = await obtenerPerfil(session);
  if (perfil?.nombre) return perfil.nombre;
  // Cuentas de Google: el metadata trae given_name/full_name/name, no
  // "nombre" (esa clave es propia del signup con contraseña).
  const meta = session?.user?.user_metadata || {};
  return meta.nombre || meta.given_name || meta.full_name || meta.name || null;
}

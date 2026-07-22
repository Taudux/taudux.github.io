/*
  Servicio de autenticación: único acceso a Supabase Auth y a la tabla perfiles.
  Depende de supabaseClient (core/supabase/supabase-client.js).
*/

const RUTAS_AUTH = Object.freeze({
  login: "/src/app/features/auth/login/",
  signup: "/src/app/features/auth/signup/",
  confirm: "/src/app/features/auth/confirm/",
  forgotPassword: "/src/app/features/auth/forgot-password/",
  resetPassword: "/src/app/features/auth/reset-password/",
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
    const baseAuth = "/src/app/features/auth/";
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

async function cerrarSesion({ scope = "global" } = {}) {
  const { error } = await supabaseClient.auth.signOut({ scope });
  if (error) {
    return { ok: false, codigo: error.code, mensaje: traducirErrorAuth(error) };
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

async function cambiarContrasena(nuevaPassword) {
  const { error } = await supabaseClient.auth.updateUser({ password: nuevaPassword });
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
    .select("nombre, apellidos, telefono, rol")
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
  const meta = session?.user?.user_metadata || {};
  return meta.nombre || null;
}

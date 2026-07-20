/*
  Servicio de autenticación: envuelve las llamadas a Supabase Auth y traduce
  sus errores al español. Depende de supabaseClient (core/supabase/supabase-client.js),
  que debe cargarse antes que este archivo.
*/

// Traduce los mensajes de error más comunes de Supabase al español
function traducirErrorAuth(mensaje) {
  const texto = (mensaje || "").toLowerCase();

  if (texto.includes("already registered") || texto.includes("already exists")) {
    return "Ese correo ya está registrado. Intenta iniciar sesión.";
  }
  if (texto.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (texto.includes("password should be at least")) {
    return "La contraseña debe tener al menos 6 caracteres.";
  }
  if (texto.includes("unable to validate email") || texto.includes("invalid email")) {
    return "Ese correo no parece válido.";
  }
  if (texto.includes("email not confirmed")) {
    return "Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.";
  }
  if (texto.includes("rate limit")) {
    return "Demasiados intentos. Espera un momento y vuelve a intentarlo.";
  }
  return "Ocurrió un error. Intenta de nuevo en unos momentos.";
}

// Registrar un usuario nuevo (nombre y apellidos se guardan en user_metadata)
async function registrarUsuario(email, password, nombre, apellidos) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { nombre, apellidos } },
  });
  if (error) {
    return { ok: false, mensaje: traducirErrorAuth(error.message) };
  }
  return { ok: true, data };
}

// Iniciar sesión
async function iniciarSesion(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, mensaje: traducirErrorAuth(error.message) };
  }
  return { ok: true, data };
}

// Cerrar sesión
async function cerrarSesion() {
  await supabaseClient.auth.signOut();
}

// Enviar correo para restablecer contraseña.
// La URL de destino debe estar en la allowlist de Redirect URLs de Supabase
// (Authentication → URL Configuration) o el enlace del correo no funcionará.
async function recuperarContrasena(email) {
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + "/src/app/features/auth/login.html",
  });
  if (error) {
    return { ok: false, mensaje: traducirErrorAuth(error.message) };
  }
  return { ok: true };
}

// Guarda una nueva contraseña (usado tras abrir el enlace de recuperación)
async function cambiarContrasena(nuevaPassword) {
  const { error } = await supabaseClient.auth.updateUser({ password: nuevaPassword });
  if (error) {
    return { ok: false, mensaje: traducirErrorAuth(error.message) };
  }
  return { ok: true };
}

// Devuelve la sesión activa (o null si no hay ninguna)
async function obtenerSesion() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

// Protege una página: si no hay sesión, redirige al login
async function requerirSesion() {
  const session = await obtenerSesion();
  if (!session) {
    window.location.href = "/src/app/features/auth/login.html";
    return null;
  }
  return session;
}

// Devuelve el nombre del usuario (de user_metadata) o null si no tiene.
// No se usa la parte del correo como respaldo (se vería a basura).
function nombreUsuario(session) {
  const meta = session.user.user_metadata || {};
  return meta.nombre || null;
}

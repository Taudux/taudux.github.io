/*
  Autenticación de usuarios con Supabase Auth.

  CONFIGURACIÓN REQUERIDA:
  Reemplaza los valores de SUPABASE_URL y SUPABASE_ANON_KEY con los de tu
  proyecto (Supabase → Project Settings → API). Es seguro que estos dos
  valores vivan en el código público del repo: son la URL y la "anon key",
  pensadas para exponerse en el navegador. La seguridad real depende de la
  configuración de Auth en el panel de Supabase, no de ocultar esta clave.

  NUNCA pongas aquí la "service_role key" (esa es secreta y no se usa en
  el navegador).
*/
const SUPABASE_URL = "https://yqkvgfqplmbbcebrivpt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlxa3ZnZnFwbG1iYmNlYnJpdnB0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0ODgxOTEsImV4cCI6MjEwMDA2NDE5MX0.wU-ylZ6agwkochwmOGe-7BROByw1qsvYpmqT5xDvF1Y";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

// Enviar correo para restablecer contraseña
async function recuperarContrasena(email) {
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + "/login.html",
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

// Protege una página: si no hay sesión, redirige a login.html
async function requerirSesion() {
  const session = await obtenerSesion();
  if (!session) {
    window.location.href = "login.html";
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

// Cierra sesión y vuelve al inicio
async function salirYVolver(e) {
  if (e) e.preventDefault();
  await cerrarSesion();
  window.location.href = "index.html";
}

// Actualiza el área de acceso del navbar según el estado de sesión
async function actualizarBotonAcceso() {
  const boton = document.getElementById("accessBtn");
  if (!boton) return;

  const session = await obtenerSesion();

  if (!session) {
    // Sin sesión: botón "Acceder"
    boton.textContent = "Acceder";
    boton.href = "login.html";
    boton.onclick = null;
    return;
  }

  const nombre = nombreUsuario(session);

  if (!nombre) {
    // Con sesión pero sin nombre (cuentas viejas): botón "Salir" simple
    boton.textContent = "Salir";
    boton.href = "#";
    boton.onclick = salirYVolver;
    return;
  }

  // Con sesión y con nombre: menú de cuenta "nombre ▾" → Salir
  const menu = document.createElement("div");
  menu.className = "user-menu";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "btn-acceso user-menu-toggle";
  toggle.textContent = nombre + " ▾"; // textContent evita inyección de HTML

  const lista = document.createElement("div");
  lista.className = "user-menu-list";

  const salir = document.createElement("a");
  salir.href = "#";
  salir.textContent = "Salir";
  salir.addEventListener("click", salirYVolver);

  lista.appendChild(salir);
  menu.appendChild(toggle);
  menu.appendChild(lista);
  boton.replaceWith(menu);

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target)) menu.classList.remove("open");
  });
}

document.addEventListener("DOMContentLoaded", actualizarBotonAcceso);

// Cuando hay sesión, agrega "Mi espacio" (→ hub) al inicio del desplegable "Explorar"
async function agregarMiEspacio() {
  const menu = document.getElementById("explorarMenu");
  if (!menu) return; // solo existe en index.html
  if (menu.querySelector(".explorar-mi-espacio")) return; // evita duplicar

  const session = await obtenerSesion();
  if (!session) return; // sin sesión no se muestra

  const link = document.createElement("a");
  link.href = "explorar.html";
  link.className = "explorar-mi-espacio";
  link.textContent = "Mi espacio";

  const sep = document.createElement("div");
  sep.className = "nav-dropdown-sep";

  menu.prepend(sep);
  menu.prepend(link);
}

document.addEventListener("DOMContentLoaded", agregarMiEspacio);

/*
  Componente de navbar compartido por todas las páginas: adapta el área de acceso
  al estado de sesión y añade "Mi espacio" al desplegable "Explorar".
  Depende de core/auth/auth.service.js, que debe cargarse antes que este archivo.
*/

// Cierra sesión y vuelve al inicio
async function salirYVolver(e) {
  if (e) e.preventDefault();
  await cerrarSesion();
  window.location.href = "/index.html";
}

// Actualiza el área de acceso del navbar según el estado de sesión
async function actualizarBotonAcceso() {
  const boton = document.getElementById("accessBtn");
  if (!boton) return;

  const session = await obtenerSesion();

  if (!session) {
    // Sin sesión: botón "Acceder"
    boton.textContent = "Acceder";
    boton.href = "/src/app/features/auth/login.html";
    boton.onclick = null;
    return;
  }

  const nombre = await nombreUsuario(session);

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
  link.href = "/src/app/features/explore/explorar.html";
  link.className = "explorar-mi-espacio";
  link.textContent = "Mi espacio";

  const sep = document.createElement("div");
  sep.className = "nav-dropdown-sep";

  menu.prepend(sep);
  menu.prepend(link);
}

document.addEventListener("DOMContentLoaded", agregarMiEspacio);

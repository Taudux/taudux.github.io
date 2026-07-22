/*
  Navbar compartido por todas las páginas. Depende de auth.service.js y debe
  cargarse después de ese servicio.
*/

async function salirYVolver(evento) {
  if (evento) evento.preventDefault();
  const resultado = await cerrarSesion();
  if (!resultado.ok) {
    if (typeof mostrarToast === "function") mostrarToast(resultado.mensaje, "error");
    return;
  }
  window.location.href = "/index.html";
}

function actualizarEstadoVisualNavbar() {
  const navbar = document.getElementById("navbar");
  if (!navbar) return;

  const desplazado = window.scrollY > 60;
  navbar.classList.toggle("navbar--scrolled", desplazado);
}

function actualizarEnlaceActivo() {
  const secciones = document.querySelectorAll("section[id]");
  const enlaces = document.querySelectorAll('.navbar__link[href^="#"]');
  let seccionActual = "";

  secciones.forEach((seccion) => {
    if (window.scrollY >= seccion.offsetTop - 150) {
      seccionActual = seccion.id;
    }
  });

  enlaces.forEach((enlace) => {
    enlace.classList.toggle(
      "navbar__link--active",
      enlace.getAttribute("href") === `#${seccionActual}`
    );
  });
}

function configurarMenuMovil() {
  const boton = document.getElementById("menuToggle");
  const enlaces = document.querySelector(".navbar__links");
  if (!boton || !enlaces) return;

  boton.addEventListener("click", () => {
    enlaces.classList.toggle("navbar__links--mobile-open");
  });

  document.querySelectorAll(".navbar__link").forEach((enlace) => {
    enlace.addEventListener("click", () => {
      enlaces.classList.remove("navbar__links--mobile-open");
    });
  });
}

function configurarDropdownExplorar() {
  const dropdown = document.getElementById("explorarDropdown");
  const boton = document.getElementById("explorarToggle");
  if (!dropdown || !boton) return;

  boton.addEventListener("click", (evento) => {
    evento.stopPropagation();
    dropdown.classList.toggle("nav-dropdown--open");
  });

  document.addEventListener("click", (evento) => {
    if (!dropdown.contains(evento.target)) {
      dropdown.classList.remove("nav-dropdown--open");
    }
  });
}

async function actualizarBotonAcceso() {
  const boton = document.getElementById("accessBtn");
  if (!boton) return;

  const session = await obtenerSesion();

  if (!session) {
    boton.textContent = "Acceder";
    boton.href = RUTAS_AUTH.login;
    boton.onclick = null;
    return;
  }

  const nombre = await nombreUsuario(session);

  if (!nombre) {
    boton.textContent = "Salir";
    boton.href = "#";
    boton.onclick = salirYVolver;
    return;
  }

  const menu = document.createElement("div");
  menu.className = "user-menu";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "user-menu__toggle button button--access";
  toggle.textContent = `${nombre} ▾`;

  const lista = document.createElement("div");
  lista.className = "user-menu__list floating-menu";

  const salir = document.createElement("a");
  salir.href = "#";
  salir.className = "user-menu__link floating-menu__link";
  salir.textContent = "Salir";
  salir.addEventListener("click", salirYVolver);

  lista.appendChild(salir);
  menu.appendChild(toggle);
  menu.appendChild(lista);
  boton.replaceWith(menu);

  toggle.addEventListener("click", (evento) => {
    evento.stopPropagation();
    menu.classList.toggle("user-menu--open");
  });

  document.addEventListener("click", (evento) => {
    if (!menu.contains(evento.target)) {
      menu.classList.remove("user-menu--open");
    }
  });
}

async function agregarMiEspacio() {
  const menu = document.getElementById("explorarMenu");
  if (!menu || menu.querySelector(".nav-dropdown__link--workspace")) return;

  const session = await obtenerSesion();
  if (!session) return;

  // Mi espacio es solo para administradores; a los demás ni se les muestra.
  if (!(await esAdmin(session))) return;

  const enlace = document.createElement("a");
  enlace.href = "/src/app/features/explore/explorar.html";
  enlace.className =
    "nav-dropdown__link nav-dropdown__link--workspace floating-menu__link";
  enlace.textContent = "Mi espacio";

  const separador = document.createElement("div");
  separador.className =
    "nav-dropdown__separator floating-menu__separator";

  menu.prepend(separador);
  menu.prepend(enlace);
}

document.addEventListener("DOMContentLoaded", () => {
  configurarMenuMovil();
  configurarDropdownExplorar();
  actualizarEstadoVisualNavbar();
  actualizarEnlaceActivo();
  actualizarBotonAcceso();
  agregarMiEspacio();
});

window.addEventListener("scroll", () => {
  actualizarEstadoVisualNavbar();
  actualizarEnlaceActivo();
});

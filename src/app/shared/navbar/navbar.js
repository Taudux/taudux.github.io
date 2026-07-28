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

window.addEventListener("taudux:operation-error", () => {
  queueMicrotask(() => {
    if (typeof mostrarToast !== "function") return;
    const reporteVisible = document.querySelector(
      '[role="alert"]:not([hidden]), .courses__startup-status--error:not([hidden]), .courses__data-status--error:not([hidden])'
    );
    if (!reporteVisible) {
      mostrarToast("No se pudo completar la operación. Intenta nuevamente.", "error");
    }
  });
});

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

  const menu = document.createElement("div");
  menu.className = "user-menu";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "user-menu__toggle";
  toggle.setAttribute("aria-label", nombre || "Mi cuenta");
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-expanded", "false");

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

  function establecerMenuAbierto(abierto) {
    menu.classList.toggle("user-menu--open", abierto);
    toggle.setAttribute("aria-expanded", String(abierto));
  }

  toggle.addEventListener("click", (evento) => {
    evento.stopPropagation();
    establecerMenuAbierto(!menu.classList.contains("user-menu--open"));
  });

  document.addEventListener("click", (evento) => {
    if (!menu.contains(evento.target)) {
      establecerMenuAbierto(false);
    }
  });

  menu.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && menu.classList.contains("user-menu--open")) {
      establecerMenuAbierto(false);
      toggle.focus();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  configurarMenuMovil();
  configurarDropdownExplorar();
  actualizarEstadoVisualNavbar();
  actualizarEnlaceActivo();
  actualizarBotonAcceso();
});

window.addEventListener("scroll", () => {
  actualizarEstadoVisualNavbar();
  actualizarEnlaceActivo();
});

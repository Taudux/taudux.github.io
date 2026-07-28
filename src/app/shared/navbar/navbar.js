/*
  Navbar compartido por todas las páginas. Depende de auth.service.js y debe
  cargarse después de ese servicio.
*/

const ENLACES_NAVEGACION = [
  { texto: "Cursos", href: "/src/app/features/courses/cursos.html" },
  { texto: "Detector IA", href: "/src/app/features/detector/detector.html" },
];

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

function crearEnlaceMenu({ texto, href, alHacerClick, destacado }) {
  const enlace = document.createElement("a");
  enlace.href = href;
  enlace.className = "nav-menu__link floating-menu__link";
  if (destacado) enlace.classList.add("nav-menu__link--cta");
  enlace.textContent = texto;
  if (alHacerClick) enlace.addEventListener("click", alHacerClick);
  return enlace;
}

function enlaceDeSesion(session) {
  if (!session) {
    return { texto: "Acceder", href: RUTAS_AUTH.login, destacado: true };
  }
  return { texto: "Salir", href: "#", alHacerClick: salirYVolver };
}

async function etiquetaDelMenu(session) {
  if (!session) return "Menú";
  const nombre = await nombreUsuario(session);
  return nombre || "Mi cuenta";
}

async function montarMenuNavegacion() {
  const boton = document.getElementById("accessBtn");
  if (!boton) return;

  const session = await obtenerSesion();

  const menu = document.createElement("div");
  menu.className = "nav-menu";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "nav-menu__toggle";
  toggle.classList.toggle("nav-menu__toggle--pulsing", !session);
  toggle.setAttribute("aria-label", await etiquetaDelMenu(session));
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-expanded", "false");

  const lista = document.createElement("div");
  lista.className = "nav-menu__list floating-menu";

  [...ENLACES_NAVEGACION, enlaceDeSesion(session)].forEach((enlace) => {
    lista.appendChild(crearEnlaceMenu(enlace));
  });

  menu.appendChild(toggle);
  menu.appendChild(lista);
  boton.replaceWith(menu);

  function establecerMenuAbierto(abierto) {
    menu.classList.toggle("nav-menu--open", abierto);
    toggle.setAttribute("aria-expanded", String(abierto));
  }

  toggle.addEventListener("click", (evento) => {
    evento.stopPropagation();
    establecerMenuAbierto(!menu.classList.contains("nav-menu--open"));
  });

  document.addEventListener("click", (evento) => {
    if (!menu.contains(evento.target)) {
      establecerMenuAbierto(false);
    }
  });

  menu.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && menu.classList.contains("nav-menu--open")) {
      establecerMenuAbierto(false);
      toggle.focus();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  configurarMenuMovil();
  actualizarEstadoVisualNavbar();
  actualizarEnlaceActivo();
  montarMenuNavegacion();
});

window.addEventListener("scroll", () => {
  actualizarEstadoVisualNavbar();
  actualizarEnlaceActivo();
});

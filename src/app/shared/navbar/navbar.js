/*
  Navbar compartido por todas las páginas. Depende de auth.service.js y debe
  cargarse después de ese servicio.
*/

const ENLACES_NAVEGACION_BASE = [
  { texto: "Cursos", href: "/app/features/courses/cursos.html", habilitado: true },
  { texto: "Portal", habilitado: false },
  { texto: "Publicaciones", habilitado: false },
  { texto: "Proyectos", habilitado: false },
  { texto: "Herramientas", habilitado: false },
];

async function salirYVolver(evento) {
  if (evento) evento.preventDefault();
  const resultado = await cerrarSesion();
  if (!resultado.ok) {
    if (typeof mostrarToast === "function") mostrarToast(resultado.mensaje, "error");
    return;
  }
  window.location.href = "/";
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

function crearItemMenu({ texto, href, alHacerClick, destacado, habilitado = true }) {
  if (!habilitado) {
    const item = document.createElement("span");
    item.className = "nav-menu__link nav-menu__link--disabled";
    item.setAttribute("aria-disabled", "true");
    item.textContent = texto;
    return item;
  }

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

async function nombreParaMenu(session) {
  if (!session) return null;
  const nombre = await nombreUsuario(session);
  return nombre || "Mi cuenta";
}

async function montarMenuNavegacion() {
  const boton = document.getElementById("accessBtn");
  if (!boton) return;

  // #accessBtn arranca oculto por CSS (navbar.css) para no parpadear el
  // "Acceder" plano mientras se resuelve la sesión. Si algo de acá adentro
  // falla antes del replaceWith, el finally lo revela como respaldo en vez
  // de dejarlo invisible para siempre.
  try {
    const session = await obtenerSesion();
    const esAdministrador = Boolean(session && await esAdmin(session));

    const enlacesNavegacion = ENLACES_NAVEGACION_BASE.map((enlace) => {
      if (enlace.texto === "Herramientas" && esAdministrador) {
        return {
          ...enlace,
          href: "/app/features/detector/detector.html",
          habilitado: true,
        };
      }
      return enlace;
    });

    const nombreCuenta = await nombreParaMenu(session);

    const menu = document.createElement("div");
    menu.className = "nav-menu";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-menu__toggle";
    toggle.classList.toggle("nav-menu__toggle--pulsing", !session);
    toggle.setAttribute("aria-label", nombreCuenta || "Menú");
    toggle.setAttribute("aria-haspopup", "menu");
    toggle.setAttribute("aria-expanded", "false");

    const lista = document.createElement("div");
    lista.className = "nav-menu__list floating-menu";

    if (nombreCuenta) {
      const encabezado = document.createElement("div");
      encabezado.className = "nav-menu__header";
      encabezado.textContent = nombreCuenta;
      lista.appendChild(encabezado);
    }

    enlacesNavegacion.forEach((enlace) => {
      lista.appendChild(crearItemMenu(enlace));
    });

    const divisor = document.createElement("hr");
    divisor.className = "nav-menu__divider";
    lista.appendChild(divisor);
    lista.appendChild(crearItemMenu(enlaceDeSesion(session)));

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
  } finally {
    if (boton.isConnected) boton.style.visibility = "visible";
  }
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

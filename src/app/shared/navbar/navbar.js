/*
  Navbar compartido por todas las páginas. Depende de auth.service.js y debe
  cargarse después de ese servicio.
*/

const ENLACES_NAVEGACION_BASE = [
  { texto: "Cursos", href: "/app/features/courses/cursos.html", habilitado: true },
  { texto: "Portal", href: "/app/features/portal/", habilitado: true },
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

/* Cache para no repetir querySelectorAll en cada evento de scroll. */
let seccionesConId = [];
let enlacesDeAncla = [];

function cachearElementosDeScroll() {
  seccionesConId = document.querySelectorAll("section[id]");
  enlacesDeAncla = document.querySelectorAll('.navbar__link[href^="#"]');
}

function actualizarEnlaceActivo() {
  if (!seccionesConId.length && !enlacesDeAncla.length) cachearElementosDeScroll();
  const secciones = seccionesConId;
  const enlaces = enlacesDeAncla;
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

/*
  Cada desplegable registra acá su función de cierre. Al abrir uno se cierran
  los demás: en ≤760px los dos toggles conviven en una barra de 6.5rem y dos
  paneles abiertos a la vez se pisarían.
*/
const cerradoresDeDesplegables = [];

function crearDesplegable({ clase, idLista, etiqueta }) {
  const menu = document.createElement("div");
  menu.className = `nav-menu nav-menu--${clase}`;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = `nav-menu__toggle nav-menu__toggle--${clase}`;
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", idLista);
  toggle.setAttribute("aria-label", etiqueta);

  const lista = document.createElement("div");
  lista.className = "nav-menu__list floating-menu";
  lista.id = idLista;

  menu.appendChild(toggle);
  menu.appendChild(lista);

  return { menu, toggle, lista };
}

function conectarDesplegable({ menu, toggle, lista }) {
  function establecerMenuAbierto(abierto) {
    menu.classList.toggle("nav-menu--open", abierto);
    toggle.setAttribute("aria-expanded", String(abierto));
  }

  const cerrar = () => establecerMenuAbierto(false);
  cerradoresDeDesplegables.push(cerrar);

  toggle.addEventListener("click", (evento) => {
    evento.stopPropagation();
    const abriendo = !menu.classList.contains("nav-menu--open");
    if (abriendo) {
      cerradoresDeDesplegables.forEach((otroCerrar) => {
        if (otroCerrar !== cerrar) otroCerrar();
      });
    }
    establecerMenuAbierto(abriendo);
  });

  document.addEventListener("click", (evento) => {
    if (!menu.contains(evento.target)) cerrar();
  });

  menu.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && menu.classList.contains("nav-menu--open")) {
      cerrar();
      toggle.focus();
    }
  });

  /*
    Las anclas del landing no recargan la página, así que sin este cierre
    explícito el panel quedaría abierto tapando la sección recién saltada.
  */
  lista.addEventListener("click", (evento) => {
    if (evento.target.closest("a")) cerrar();
  });

  return cerrar;
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

function resolverEnlacesNavegacion(esAdministrador) {
  return ENLACES_NAVEGACION_BASE.map((enlace) => {
    if (enlace.texto === "Herramientas" && esAdministrador) {
      return {
        ...enlace,
        href: "/app/features/detector/detector.html",
        habilitado: true,
      };
    }
    return enlace;
  });
}

/*
  Las anclas salen del DOM, no de una constante: el markup de index.html sigue
  siendo la única fuente de esas secciones y no hay riesgo de que las dos copias
  se desincronicen. En páginas sin anclas devuelve [] y el panel arranca directo
  con los enlaces del sitio.
*/
function anclasDeLaPagina() {
  const anclas = document.querySelectorAll('.navbar__links .navbar__link[href^="#"]');
  return Array.from(anclas)
    .filter((ancla) => ancla.id !== "accessBtn")
    .map((ancla) => ({
      texto: ancla.textContent.trim(),
      href: ancla.getAttribute("href"),
    }));
}

function montarPanelNavegacion(lista, { anclas, enlaces }) {
  const textosDeAnclas = new Set(anclas.map((ancla) => ancla.texto.toLowerCase()));
  /*
    "Herramientas" existe como ancla del landing y como enlace admin al
    detector. Si el ancla ya ocupa ese texto, el enlace del sitio se omite:
    dos entradas con el mismo nombre y distinto destino son indistinguibles.
  */
  const enlacesSinRepetir = enlaces.filter(
    (enlace) => !textosDeAnclas.has(enlace.texto.toLowerCase())
  );

  anclas.forEach((ancla) => lista.appendChild(crearItemMenu(ancla)));

  if (anclas.length && enlacesSinRepetir.length) {
    const divisor = document.createElement("hr");
    divisor.className = "nav-menu__divider";
    lista.appendChild(divisor);
  }

  enlacesSinRepetir.forEach((enlace) => lista.appendChild(crearItemMenu(enlace)));
}

/*
  Shell síncrono: el botón se monta en DOMContentLoaded con su tamaño final para
  que el brand no salte cuando resuelve la sesión. El contenido de la lista lo
  completa montarMenus() después, con los datos de sesión ya resueltos.
*/
function montarNavegacionMovil() {
  const navbar = document.querySelector(".navbar");
  if (!navbar || !navbar.querySelector(".navbar__links")) return;

  const { menu, toggle, lista } = crearDesplegable({
    clase: "site",
    idLista: "menuNavegacionLista",
    etiqueta: "Menú de navegación",
  });
  toggle.textContent = "☰";

  navbar.prepend(menu);
  conectarDesplegable({ menu, toggle, lista });
}

async function montarMenus() {
  const boton = document.getElementById("accessBtn");
  if (!boton) return;

  // #accessBtn arranca oculto por CSS (navbar.css) para no parpadear el
  // "Acceder" plano mientras se resuelve la sesión. Si algo de acá adentro
  // falla antes del replaceWith, el finally lo revela como respaldo en vez
  // de dejarlo invisible para siempre.
  try {
    const session = await obtenerSesion();
    const esAdministrador = Boolean(session && await esAdmin(session));

    const enlacesNavegacion = resolverEnlacesNavegacion(esAdministrador);

    const listaNavegacion = document.getElementById("menuNavegacionLista");
    if (listaNavegacion) {
      montarPanelNavegacion(listaNavegacion, {
        anclas: anclasDeLaPagina(),
        enlaces: enlacesNavegacion,
      });
    }

    const nombreCuenta = await nombreParaMenu(session);

    const { menu, toggle, lista } = crearDesplegable({
      clase: "account",
      idLista: "menuCuentaLista",
      etiqueta: nombreCuenta ? `Cuenta: ${nombreCuenta}` : "Cuenta",
    });
    toggle.classList.toggle("nav-menu__toggle--pulsing", !session);

    if (nombreCuenta) {
      const encabezado = document.createElement("div");
      encabezado.className = "nav-menu__header";
      encabezado.textContent = nombreCuenta;
      lista.appendChild(encabezado);
    }

    /*
      En mobile la navegación vive en la hamburguesa, así que este grupo se
      oculta por CSS. En desktop sigue siendo la única vía de navegación de las
      páginas sin fila de enlaces (cursos, detector, privacidad).
    */
    const grupoNavegacion = document.createElement("div");
    grupoNavegacion.className = "nav-menu__group nav-menu__group--nav";
    enlacesNavegacion.forEach((enlace) => {
      grupoNavegacion.appendChild(crearItemMenu(enlace));
    });
    lista.appendChild(grupoNavegacion);

    const divisor = document.createElement("hr");
    divisor.className = "nav-menu__divider";
    lista.appendChild(divisor);
    lista.appendChild(crearItemMenu(enlaceDeSesion(session)));

    boton.replaceWith(menu);
    conectarDesplegable({ menu, toggle, lista });
  } finally {
    if (boton.isConnected) boton.style.visibility = "visible";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  montarNavegacionMovil();
  cachearElementosDeScroll();
  actualizarEstadoVisualNavbar();
  actualizarEnlaceActivo();
  montarMenus();
});

/* Throttle con requestAnimationFrame: como mucho una actualización por frame,
   aunque lleguen varios eventos de scroll. */
let actualizacionPendiente = false;

window.addEventListener(
  "scroll",
  () => {
    if (actualizacionPendiente) return;
    actualizacionPendiente = true;
    requestAnimationFrame(() => {
      actualizarEstadoVisualNavbar();
      actualizarEnlaceActivo();
      actualizacionPendiente = false;
    });
  },
  { passive: true }
);

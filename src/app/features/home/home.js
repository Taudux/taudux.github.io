/*
  Comportamiento exclusivo del landing. Depende de navbar.js, toast.js y de
  tsParticles, cargados antes de este archivo.
*/

const about = document.querySelector(".about");
let desplazamientoEnCurso = false;
let desplazamientoObjetivo = window.scrollY;

function actualizarAparicionAbout() {
  if (!about) return;
  const limite = window.innerHeight * 0.85;
  if (about.getBoundingClientRect().top < limite) {
    about.classList.add("about--visible");
  }
}

function animarRueda() {
  desplazamientoEnCurso = true;
  const posicionActual = window.scrollY;
  const diferencia = desplazamientoObjetivo - posicionActual;
  const paso = diferencia * 0.03;
  window.scrollTo(0, posicionActual + paso);

  if (Math.abs(diferencia) > 0.5) {
    requestAnimationFrame(animarRueda);
  } else {
    desplazamientoEnCurso = false;
  }
}

function controlarRueda(evento) {
  evento.preventDefault();
  desplazamientoObjetivo += evento.deltaY > 0 ? 80 : -80;
  desplazamientoObjetivo = Math.max(
    0,
    Math.min(document.body.scrollHeight - window.innerHeight, desplazamientoObjetivo)
  );

  if (!desplazamientoEnCurso) animarRueda();
}

function configurarNavegacionInterna() {
  document.querySelectorAll('.navbar__link[href^="#"]').forEach((enlace) => {
    enlace.addEventListener("click", (evento) => {
      evento.preventDefault();
      window.removeEventListener("wheel", controlarRueda);

      const destino = document.querySelector(enlace.getAttribute("href"));
      if (!destino) return;

      const inicio = window.scrollY;
      const distancia = destino.offsetTop - inicio;
      const duracion = 2000;
      let marcaInicial = null;

      function suavizar(progreso) {
        return progreso < 0.5
          ? 2 * progreso * progreso
          : -1 + (4 - 2 * progreso) * progreso;
      }

      function avanzar(marcaActual) {
        if (!marcaInicial) marcaInicial = marcaActual;
        const progreso = Math.min((marcaActual - marcaInicial) / duracion, 1);
        const nuevaPosicion = inicio + distancia * suavizar(progreso);
        window.scrollTo(0, nuevaPosicion);
        desplazamientoObjetivo = nuevaPosicion;

        if (progreso < 1) {
          requestAnimationFrame(avanzar);
        } else {
          window.addEventListener("wheel", controlarRueda, { passive: false });
        }
      }

      requestAnimationFrame(avanzar);
    });
  });
}

function cargarParticulasHero() {
  if (!window.tsParticles) return;

  tsParticles.load("particles-hero", {
    fpsLimit: 60,
    fullScreen: {
      enable: false,
      zIndex: 0,
    },
    background: {
      color: { value: "transparent" },
    },
    particles: {
      number: {
        value: 120,
        density: {
          enable: true,
          width: 1920,
          height: 1080,
        },
      },
      color: {
        value: ["#00d7ff", "#1d63ff", "#c8f7ff"],
      },
      links: {
        enable: false,
      },
      move: {
        enable: true,
        speed: { min: 0.12, max: 0.55 },
        direction: "none",
        random: true,
        straight: false,
        outModes: { default: "out" },
      },
      shape: {
        type: "circle",
      },
      opacity: {
        value: { min: 0.12, max: 0.72 },
        animation: {
          enable: true,
          speed: 0.45,
          minimumValue: 0.08,
          sync: false,
        },
      },
      size: {
        value: { min: 0.5, max: 2.1 },
        animation: {
          enable: true,
          speed: 0.8,
          minimumValue: 0.35,
          sync: false,
        },
      },
    },
    interactivity: {
      events: {
        onHover: { enable: false },
        onClick: { enable: false },
        resize: true,
      },
    },
    detectRetina: true,
  });
}

function cargarParticulas() {
  if (!window.tsParticles) return;

  tsParticles.load("particles-quienes", {
    fullScreen: {
      enable: false,
      zIndex: 0,
    },
    background: {
      color: { value: "#0d0f11" },
      image: "url('/src/assets/images/01.png')",
      position: "50% 50%",
      repeat: "no-repeat",
      size: "cover",
      opacity: 1,
    },
    backgroundMask: {
      enable: true,
      composite: "destination-out",
      cover: {
        color: { value: "#0d0f11" },
        opacity: 1,
      },
    },
    particles: {
      number: {
        value: 80,
        density: {
          enable: true,
          width: 1920,
          height: 1080,
        },
      },
      color: { value: "#ffffff" },
      links: {
        enable: true,
        distance: 150,
        color: "#ffffff",
        opacity: 1,
        width: 1,
      },
      move: {
        enable: true,
        speed: 2,
      },
      shape: { type: "circle" },
      opacity: { value: 1 },
      size: { value: { min: 1, max: 30 } },
    },
    interactivity: {
      events: {
        onHover: {
          enable: true,
          mode: "bubble",
        },
        onClick: {
          enable: true,
          mode: "push",
        },
        resize: true,
      },
      modes: {
        bubble: {
          distance: 400,
          duration: 2,
          opacity: 1,
          size: 100,
        },
        push: { quantity: 4 },
      },
    },
    detectRetina: true,
  });
}

function observarServicios() {
  const tarjetas = document.querySelectorAll(".services__card");
  const observador = new IntersectionObserver((entradas, instancia) => {
    entradas.forEach((entrada) => {
      if (entrada.isIntersecting) {
        entrada.target.classList.add("services__card--visible");
        instancia.unobserve(entrada.target);
      }
    });
  }, { threshold: 0.3 });

  tarjetas.forEach((tarjeta) => observador.observe(tarjeta));
}

function configurarPausaCarrusel(selector) {
  const carrusel = document.querySelector(selector);
  if (!carrusel) return;

  const pista = carrusel.querySelector(".carousel__track");
  let temporizador;

  carrusel.addEventListener("mouseenter", () => {
    temporizador = setTimeout(() => {
      pista.classList.add("carousel__track--paused");
    }, 2000);
  });

  carrusel.addEventListener("mouseleave", () => {
    clearTimeout(temporizador);
    pista.classList.remove("carousel__track--paused");
  });
}

function completarCarruselInfinito() {
  document.querySelectorAll(".carousel__track").forEach((pista) => {
    const grupoOriginal = pista.querySelector(".carousel__group");
    if (!grupoOriginal) return;

    for (let repeticion = 0; repeticion < 3; repeticion += 1) {
      const copia = grupoOriginal.cloneNode(true);
      copia.setAttribute("aria-hidden", "true");

      copia.querySelectorAll(".carousel__item").forEach((icono) => {
        icono.alt = "";
      });

      pista.appendChild(copia);
    }
  });
}

function configurarFormularioContacto() {
  const formulario = document.getElementById("contactForm");
  if (!formulario) return;

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();

    try {
      const respuesta = await fetch(formulario.action, {
        method: "POST",
        body: new FormData(formulario),
        headers: { Accept: "application/json" },
      });

      if (respuesta.ok) {
        formulario.reset();
        mostrarToast("Gracias por contactarnos. ¡Te responderemos muy pronto!", "success");
      } else {
        mostrarToast("Ocurrió un error al enviar el mensaje.", "error");
      }
    } catch {
      mostrarToast("Ocurrió un error al conectar con el servidor.", "error");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  actualizarAparicionAbout();
  configurarNavegacionInterna();
  cargarParticulasHero();
  cargarParticulas();
  observarServicios();
  completarCarruselInfinito();
  configurarPausaCarrusel("#carousel-top");
  configurarPausaCarrusel("#carousel-bottom");
  configurarFormularioContacto();
});

window.addEventListener("scroll", actualizarAparicionAbout);
window.addEventListener("wheel", controlarRueda, { passive: false });

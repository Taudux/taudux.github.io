/* Comportamiento exclusivo del landing. Depende de toast.js y tsParticles. */

const hero = document.querySelector(".hero");

function actualizarEstadoHero() {
  hero?.classList.toggle("hero--logo-hidden", window.scrollY > 60);
}

function observarAparicion(selector, modificador, umbral) {
  const elementos = document.querySelectorAll(selector);
  if (!elementos.length) return;

  const observador = new IntersectionObserver((entradas) => {
    entradas.forEach((entrada) => {
      if (!entrada.isIntersecting) return;
      entrada.target.classList.add(modificador);
      observador.unobserve(entrada.target);
    });
  }, { threshold: umbral });

  elementos.forEach((elemento) => observador.observe(elemento));
}

function cargarParticulasHero() {
  if (!window.tsParticles) return;

  window.tsParticles.load("particles-hero", {
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

function cargarParticulasAbout() {
  if (!window.tsParticles) return;

  window.tsParticles.load("particles-quienes", {
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

function configurarCarruseles() {
  document.querySelectorAll(".carousel").forEach((carrusel) => {
    const pista = carrusel.querySelector(".carousel__track");
    if (!pista) return;

    const grupoOriginal = pista.querySelector(".carousel__group");
    if (!grupoOriginal) return;

    for (let repeticion = 0; repeticion < 3; repeticion += 1) {
      const copia = grupoOriginal.cloneNode(true);
      copia.setAttribute("aria-hidden", "true");
      pista.appendChild(copia);
    }

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
  actualizarEstadoHero();
  observarAparicion(".about", "about--visible", 0.15);
  observarAparicion(".services__card", "services__card--visible", 0.3);
  cargarParticulasHero();
  cargarParticulasAbout();
  configurarCarruseles();
  configurarFormularioContacto();
});

window.addEventListener("scroll", actualizarEstadoHero, { passive: true });

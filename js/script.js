const navbar = document.getElementById('navbar');
const logoLarge = document.getElementById('logoLarge');
const logoSmall = document.getElementById('logoSmall');
const sections = document.querySelectorAll("section");
const navLinks = document.querySelectorAll(".nav-buttons a");
const scrollFadeElements = document.querySelectorAll('.scroll-fade');

let isScrolling = false;
let targetScroll = window.scrollY;

// Mostrar u ocultar la barra de navegación
document.addEventListener("DOMContentLoaded", function () {
  const navButtons = document.querySelector(".nav-buttons");

  function toggleNavButtons() {
    if (window.scrollY > 100) {
      navButtons.classList.add("show");
    } else {
      navButtons.classList.remove("show");
    }
  }

  toggleNavButtons();
  window.addEventListener("scroll", function () {
    if (window.scrollY > 100) {
      navButtons.classList.add("show");
    } else {
      navButtons.classList.remove("show");
    }
  });
});

// Cambiar estilo de navbar y logo al hacer scroll
window.addEventListener('scroll', () => {
  if (window.scrollY > 60) {
    navbar.classList.add('scrolled');
    logoLarge.style.opacity = '0';
    logoLarge.style.transform = 'scale(0.8) translateY(-20px)';
  } else {
    navbar.classList.remove('scrolled');
    logoLarge.style.opacity = '1';
    logoLarge.style.transform = 'scale(1) translateY(0)';
  }

  const menuToggle = document.getElementById('menuToggle');
  const isMobile = window.innerWidth <= 768;

  if (isMobile && window.scrollY > 60) {
    menuToggle.style.display = 'block';
  } else {
    menuToggle.style.display = 'none';
  }
});

window.addEventListener('load', () => {
  const isMobile = window.innerWidth <= 768;
  const menuToggle = document.getElementById('menuToggle');

  if (isMobile && window.scrollY > 60) {
    menuToggle.style.display = 'block';
  } else {
    menuToggle.style.display = 'none';
  }
});

// Resaltar enlace activo en la navegación
window.addEventListener("scroll", () => {
  let current = "";

  sections.forEach((section) => {
    const sectionTop = section.offsetTop;
    if (scrollY >= sectionTop - 150) {
      current = section.getAttribute("id");
    }
  });

  navLinks.forEach((link) => {
    link.classList.remove("active");
    if (link.getAttribute("href") === "#" + current) {
      link.classList.add("active");
    }
  });
});

// Menú hamburguesa
document.addEventListener("DOMContentLoaded", function () {
  const menuToggle = document.getElementById("menuToggle");
  const navButtons = document.querySelector(".nav-buttons");

  menuToggle.addEventListener("click", () => {
    navButtons.classList.toggle("show-mobile");
  });

  // Cierra menú al hacer clic en un enlace
  document.querySelectorAll('.nav-buttons a').forEach(link => {
    link.addEventListener("click", () => {
      navButtons.classList.remove("show-mobile");
    });
  });
});

// Efecto de fade al hacer scroll
const handleScrollFade = () => {
  const triggerBottom = window.innerHeight * 0.85;

  scrollFadeElements.forEach(el => {
    const boxTop = el.getBoundingClientRect().top;

    if (boxTop < triggerBottom) {
      el.classList.add('visible');
    }
  });
};

window.addEventListener('scroll', handleScrollFade);
window.addEventListener('load', handleScrollFade);

// Función para scroll con la rueda del mouse
function handleWheelScroll(e) {
  e.preventDefault();

  const scrollSpeed = 80;
  targetScroll += e.deltaY > 0 ? scrollSpeed : -scrollSpeed;
  targetScroll = Math.max(0, Math.min(document.body.scrollHeight - window.innerHeight, targetScroll));

  if (!isScrolling) {
    smoothMouseScroll();
  }
}

// Scroll personalizado con rueda
window.addEventListener("wheel", handleWheelScroll, { passive: false });

function smoothMouseScroll() {
  isScrolling = true;

  const currentY = window.scrollY;
  const diff = targetScroll - currentY;
  const step = diff * 0.03;

  window.scrollTo(0, currentY + step);

  if (Math.abs(diff) > 0.5) {
    requestAnimationFrame(smoothMouseScroll);
  } else {
    isScrolling = false;
  }
}

// Animación personalizada de scroll al hacer clic en un enlace del navbar
document.querySelectorAll('.nav-buttons a').forEach(link => {
  link.addEventListener('click', function (e) {
    e.preventDefault();

    // ❌ Eliminar scroll por rueda durante la animación
    window.removeEventListener("wheel", handleWheelScroll);

    const targetId = this.getAttribute('href');
    const target = document.querySelector(targetId);
    if (!target) return;

    const targetPosition = target.offsetTop;
    const startPosition = window.scrollY;
    const distance = targetPosition - startPosition;
    const duration = 2000;
    let start = null;

    function easeInOutQuad(t) {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    function step(timestamp) {
      if (!start) start = timestamp;
      const progress = timestamp - start;
      const percent = Math.min(progress / duration, 1);
      const newScroll = startPosition + distance * easeInOutQuad(percent);
      window.scrollTo(0, newScroll);
      targetScroll = newScroll;

      if (percent < 1) {
        requestAnimationFrame(step);
      } else {
        // ✅ Volver a activar scroll por rueda
        window.addEventListener("wheel", handleWheelScroll, { passive: false });
      }
    }

    requestAnimationFrame(step);
  });
});

// Cargar partículas en la sección "¿Quiénes somos?"
tsParticles.load("particles-quienes", {
  fullScreen: {
    enable: false,
    zIndex: 0
  },
  background: {
    color: {
      value: "#0d0f11"
    },
    image: "url('images/01.png')",
    position: "50% 50%",
    repeat: "no-repeat",
    size: "cover",
    opacity: 1
  },
  backgroundMask: {
    enable: true,
    composite: "destination-out",
    cover: {
      color: {
        value: "#0d0f11"
      },
      opacity: 1
    }
  },
  particles: {
    number: {
      value: 80,
      density: {
        enable: true,
        width: 1920,
        height: 1080
      }
    },
    color: {
      value: "#ffffff"
    },
    links: {
      enable: true,
      distance: 150,
      color: "#ffffff",
      opacity: 1,
      width: 1
    },
    move: {
      enable: true,
      speed: 2
    },
    shape: {
      type: "circle"
    },
    opacity: {
      value: 1
    },
    size: {
      value: { min: 1, max: 30 }
    }
  },
  interactivity: {
    events: {
      onHover: {
        enable: true,
        mode: "bubble"
      },
      onClick: {
        enable: true,
        mode: "push"
      },
      resize: true
    },
    modes: {
      bubble: {
        distance: 400,
        duration: 2,
        opacity: 1,
        size: 100
      },
      push: {
        quantity: 4
      }
    }
  },
  detectRetina: true
});


/**seccion de servicios */
document.addEventListener("DOMContentLoaded", function () {
  const servicios = document.querySelectorAll(".servicio");

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("aparece");
        observer.unobserve(entry.target); // Solo animar una vez
      }
    });
  }, {
    threshold: 0.2
  });

  servicios.forEach(servicio => {
    observer.observe(servicio);
  });
});

// Animación de aparición de servicios solo una vez
document.addEventListener('DOMContentLoaded', () => {
  const servicios = document.querySelectorAll('.servicio-item');

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        obs.unobserve(entry.target); // Deja de observar para que no se repita
      }
    });
  }, {
    threshold: 0.3
  });

  servicios.forEach(item => observer.observe(item));
});

/*Seccion de herramientas */

// Agregar pausa con 2 segundos de hover continuo
function pauseCarouselOnHover(selector) {
  const carousel = document.querySelector(selector);
  const track = carousel.querySelector('.carousel-track');

  let hoverTimeout;

  carousel.addEventListener('mouseenter', () => {
    hoverTimeout = setTimeout(() => {
      track.style.animationPlayState = 'paused';
    }, 2000);
  });

  carousel.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimeout);
    track.style.animationPlayState = 'running';
  });
}

function duplicateCarouselItems() {
  document.querySelectorAll('.carousel-track').forEach(track => {
    const items = [...track.children];
    items.forEach(item => {
      const clone = item.cloneNode(true);
      track.appendChild(clone);
    });
  });
}
window.addEventListener('DOMContentLoaded', duplicateCarouselItems);

pauseCarouselOnHover('#carousel-top');
pauseCarouselOnHover('#carousel-bottom');

/* funcionalidad para el botón de contacto */

document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("contactForm");
  const thankYouMessage = document.getElementById("thankYouMessage");

  form.addEventListener("submit", function (event) {
    event.preventDefault(); // Evita recargar la página

    const formData = new FormData(form);

    fetch(form.action, {
      method: "POST",
      body: formData,
      headers: {
        'Accept': 'application/json'
      }
    }).then(response => {
      if (response.ok) {
        form.reset();
        thankYouMessage.style.display = "block";
      } else {
        alert("Ocurrió un error al enviar el mensaje.");
      }
    }).catch(error => {
      alert("Ocurrió un error al conectar con el servidor.");
    });
  });
});

document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('contactForm');
  const thankYouMessage = document.getElementById('thankYouMessage');

  form.addEventListener('submit', function (e) {
    e.preventDefault(); // Evita envío inmediato

    const formData = new FormData(form);
    const actionUrl = form.action;

    fetch(actionUrl, {
      method: 'POST',
      body: formData,
      headers: {
        'Accept': 'application/json'
      }
    })
      .then(response => {
        if (response.ok) {
          form.reset(); // Limpia los campos
          thankYouMessage.style.display = 'block'; // Muestra mensaje
        } else {
          alert("Ocurrió un error. Intenta de nuevo más tarde.");
        }
      })
      .catch(error => {
        alert("No se pudo enviar el mensaje. Verifica tu conexión.");
      });
  });
});

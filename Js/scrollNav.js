let lastScrollTop = 0; // Variable para rastrear la posición del scroll
const navbar = document.querySelector('.scroll-navbar'); // Selecciona la barra de navegación

// Añadir la clase 'fixed' a la barra de navegación para que sea fija
navbar.classList.add('fixed');

// Inicialmente ocultamos la barra de navegación
navbar.style.transform = 'translateY(-100%)';

window.addEventListener('scroll', function() {
    let scrollTop = window.pageYOffset || document.documentElement.scrollTop; // Obtiene la posición del scroll

    if (scrollTop > 0) {
        // Solo proceder si no estamos en la parte superior de la página
        if (scrollTop > lastScrollTop) {
            // El usuario se desplaza hacia abajo
            navbar.style.transform = 'translateY(0)'; // Muestra la barra de navegación
        } else {
            // El usuario se desplaza hacia arriba
            navbar.style.transform = 'translateY(-100%)'; // Oculta la barra de navegación
        }
    }
  
    // Actualiza lastScrollTop para la próxima comparación
    lastScrollTop = scrollTop <= 0 ? 0 : scrollTop; // Para evitar que el valor se vuelva negativo
});

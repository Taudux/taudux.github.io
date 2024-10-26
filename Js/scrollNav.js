let lastScrollTop = 0;
const navbar = document.querySelector('.scroll-navbar');
navbar.classList.add('fixed');
navbar.style.transform = 'translateY(-100%)';
window.addEventListener('scroll', function() {
    let scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    if (scrollTop > 0) {
        if (scrollTop > lastScrollTop) {
            navbar.style.transform = 'translateY(0)'; 
        } else {
            navbar.style.transform = 'translateY(-100%)';
        }
    }
    lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
});

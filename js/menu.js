(function(){
    const openButton = document.querySelector('.navHamburguer');
    const menu = document.querySelector('.navLinkMenu');
    const closeMenu = document.querySelector('.navClose');

    if (openButton && menu && closeMenu) { 
        openButton.addEventListener('click', () => {
            menu.classList.add('navLinkMenu--show');
        });

        closeMenu.addEventListener('click', () => {
            menu.classList.remove('navLinkMenu--show');
        });
    }
})();

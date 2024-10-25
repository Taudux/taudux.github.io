(function() {
    const sliders = [...document.querySelectorAll('.testimonyBody')];
    const buttonNext = document.querySelector('#next');
    const buttonBefore = document.querySelector('#before');

    let value;
    buttonNext.addEventListener('click', () => {
        changePosition(1);
    });
    buttonBefore.addEventListener('click', () => {
        changePosition(-1);
    });

    const changePosition = (add) => {
    
        const currentTestimony = document.querySelector('.testimonyBody--Show').dataset.id;
        value = Number(currentTestimony);
        value += add;

        sliders[Number(currentTestimony) - 1].classList.remove('testimonyBody--Show');

        if (value > sliders.length) {
            value = 1;
        } else if (value < 1) {
            value = sliders.length;
        }

        sliders[value - 1].classList.add('testimonyBody--Show');
    }
})();

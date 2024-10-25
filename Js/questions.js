(function () {
    const titleQuestions = document.querySelectorAll('.questionTitle');

    titleQuestions.forEach(question => {
        question.addEventListener('click', () => {
            let answer = question.nextElementSibling;
            let addPadding = question.parentElement.parentElement;

            addPadding.classList.toggle('questionsPadding--add')
            question.children[0].classList.toggle('questionsArrow--rotate')
            // Alternar altura
            if (answer.style.height) {
                answer.style.height = null; // Colapsa la respuesta
            } else {
                answer.style.height = `${answer.scrollHeight}px`; // Expande la respuesta
            }
        });
    });
})();

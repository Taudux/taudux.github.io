/*
  Catálogo de cursos: lista pública de solo lectura, NO requiere sesión (se accede
  desde el navbar sin iniciar sesión). La lectura de la tabla la habilita la RLS
  pública de `cursos` (migración 0005). La gestión (alta/edición/borrado) vive en
  gestionar-cursos.js. Depende de cursos.service.js y toast.js (cargar antes).
*/

(async () => {
  const lista = document.getElementById("cursosLista");

  const resultado = await listarCursos();
  if (!resultado.ok) {
    mostrarToast(resultado.mensaje, "error");
  } else if (resultado.data.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "courses__empty";
    vacio.textContent = "Aún no hay cursos publicados.";
    lista.appendChild(vacio);
  } else {
    resultado.data.forEach((curso) => lista.appendChild(crearTarjetaCurso(curso)));
  }
})();

// Tarjeta de solo lectura: imagen opcional, título, descripción y enlace externo.
function crearTarjetaCurso(curso) {
  const tarjeta = document.createElement("article");
  tarjeta.className = "courses__card panel";

  if (curso.imagen_url && esUrlSegura(curso.imagen_url)) {
    const img = document.createElement("img");
    img.className = "courses__card-image";
    img.src = curso.imagen_url;
    img.alt = "";
    tarjeta.appendChild(img);
  }

  const titulo = document.createElement("h3");
  titulo.className = "courses__card-title";
  titulo.textContent = curso.titulo;
  tarjeta.appendChild(titulo);

  if (curso.descripcion) {
    const desc = document.createElement("p");
    desc.className = "courses__card-description";
    desc.textContent = curso.descripcion;
    tarjeta.appendChild(desc);
  }

  const acciones = document.createElement("div");
  acciones.className = "courses__card-actions";
  const enlace = document.createElement("a");
  enlace.className = "courses__card-link";
  enlace.textContent = "Ir al curso →";
  if (esUrlSegura(curso.enlace)) {
    enlace.href = curso.enlace;
    enlace.target = "_blank";
    enlace.rel = "noopener noreferrer";
  }
  acciones.appendChild(enlace);
  tarjeta.appendChild(acciones);

  return tarjeta;
}

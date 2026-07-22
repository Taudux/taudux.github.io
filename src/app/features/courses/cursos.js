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

// Tarjeta de solo lectura: imagen, badges de modalidad/categoría/próximamente, título,
// horario y rango de fechas (omitidos si el curso es "próximamente"), instructor,
// cupo/costo, descripción y botón "Más información" (gate de sesión, ver F-008) —
// cada dato opcional solo si existe.
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

  const badgeModalidad = etiquetaModalidad(curso);
  if (badgeModalidad) {
    const badgeEl = document.createElement("span");
    badgeEl.className = `courses__badge courses__badge--${curso.modalidad}`;
    badgeEl.textContent = badgeModalidad;
    tarjeta.appendChild(badgeEl);
  }

  if (curso.categoria) {
    const categoriaEl = document.createElement("span");
    categoriaEl.className = "courses__badge courses__badge--categoria";
    categoriaEl.textContent = curso.categoria;
    tarjeta.appendChild(categoriaEl);
  }

  if (curso.proximamente) {
    const proximamenteEl = document.createElement("span");
    proximamenteEl.className = "courses__badge courses__badge--proximamente";
    proximamenteEl.textContent = "Próximamente";
    tarjeta.appendChild(proximamenteEl);
  }

  const titulo = document.createElement("h3");
  titulo.className = "courses__card-title";
  titulo.textContent = curso.titulo;
  tarjeta.appendChild(titulo);

  if (!curso.proximamente) {
    const horario = formatearHorario(curso);
    if (horario) {
      const horarioEl = document.createElement("p");
      horarioEl.className = "courses__card-meta";
      horarioEl.textContent = horario;
      tarjeta.appendChild(horarioEl);
    }

    const rango = formatearRangoFechas(curso);
    if (rango) {
      const rangoEl = document.createElement("p");
      rangoEl.className = "courses__card-dates";
      rangoEl.textContent = rango;
      tarjeta.appendChild(rangoEl);
    }
  }

  if (curso.instructor) {
    const instructorEl = document.createElement("p");
    instructorEl.className = "courses__card-instructor";
    instructorEl.textContent = `Imparte: ${curso.instructor}`;
    tarjeta.appendChild(instructorEl);
  }

  const costo = formatearCosto(curso.costo);
  const extra = [curso.cupo_maximo ? `Cupo: ${curso.cupo_maximo}` : null, costo]
    .filter(Boolean)
    .join(" · ");
  if (extra) {
    const extraEl = document.createElement("p");
    extraEl.className = "courses__card-extra";
    extraEl.textContent = extra;
    tarjeta.appendChild(extraEl);
  }

  if (curso.descripcion) {
    const desc = document.createElement("p");
    desc.className = "courses__card-description";
    desc.textContent = curso.descripcion;
    tarjeta.appendChild(desc);
  }

  const acciones = document.createElement("div");
  acciones.className = "courses__card-actions";
  const masInfo = document.createElement("button");
  masInfo.className = "button button--outline";
  masInfo.type = "button";
  masInfo.textContent = "Más información";
  masInfo.addEventListener("click", verMasInformacion);
  acciones.appendChild(masInfo);
  tarjeta.appendChild(acciones);

  return tarjeta;
}

// Gate de sesión para el detalle del curso: sin sesión, avisa y manda a login;
// con sesión, el detalle real todavía no existe (placeholder, ver F-007).
async function verMasInformacion() {
  const session = await obtenerSesion();
  if (!session) {
    mostrarToast("Inicia sesión para ver más información.", "error");
    window.location.href = "/src/app/features/auth/login.html";
    return;
  }
  mostrarToast("El detalle del curso estará disponible pronto.");
}

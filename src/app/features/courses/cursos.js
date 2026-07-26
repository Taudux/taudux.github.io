/*
  Catálogo de cursos: lista pública de solo lectura, NO requiere sesión (se accede
  desde el navbar sin iniciar sesión). La lectura de la tabla la habilita la RLS
  pública de `cursos` (migración 0005). La administración vive en las tres páginas
  gestionar-cursos/curso/categorias. Depende de cursos.service.js y toast.js.
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

// Tarjeta pública de solo lectura y activable: imagen, título, descripción,
// información de modalidad/fechas/horario y chips de cupo/costo/estado.
// Fechas y horario se omiten si el curso es "próximamente".
function crearTarjetaCurso(curso) {
  const tarjeta = document.createElement("article");
  tarjeta.className = "courses__card courses__card--catalog panel";

  const media = document.createElement("div");
  media.className = "courses__card-media";

  if (curso.imagen_url && esUrlSegura(curso.imagen_url)) {
    const img = document.createElement("img");
    img.className = "courses__card-image";
    img.src = curso.imagen_url;
    img.alt = curso.titulo ? `Portada del curso ${curso.titulo}` : "Portada del curso";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => crearFallbackCurso(media, curso), { once: true });
    media.appendChild(img);
  } else {
    crearFallbackCurso(media, curso);
  }

  tarjeta.appendChild(media);

  const cuerpo = document.createElement("div");
  cuerpo.className = "courses__card-body";

  const titulo = document.createElement("h2");
  titulo.className = "courses__card-title";
  titulo.textContent = curso.titulo;
  cuerpo.appendChild(titulo);

  if (curso.descripcion) {
    const desc = document.createElement("p");
    desc.className = "courses__card-description";
    desc.textContent = curso.descripcion;
    cuerpo.appendChild(desc);
  }

  const informacion = document.createElement("div");
  informacion.className = "courses__card-info";

  agregarInformacionCurso(
    informacion,
    "modalidad",
    "Modalidad",
    etiquetaModalidad(curso)
  );

  if (!curso.proximamente) {
    const rango = formatearRangoFechas(curso);
    agregarInformacionCurso(informacion, "fechas", "Fechas", rango);

    const horario = formatearHorario(curso);
    agregarInformacionCurso(informacion, "horario", "Horario", horario);
  }

  if (informacion.childElementCount) {
    cuerpo.appendChild(informacion);
  }

  const chips = document.createElement("div");
  chips.className = "courses__card-chips";

  agregarChipCurso(
    chips,
    curso.cupo_maximo ? `Cupo: ${curso.cupo_maximo} lugares` : null
  );
  agregarChipCurso(chips, formatearCosto(curso.costo));
  if (curso.proximamente) {
    agregarChipCurso(chips, "Próximamente", "proximamente");
  }

  if (chips.childElementCount) {
    cuerpo.appendChild(chips);
  }

  tarjeta.appendChild(cuerpo);

  const activador = document.createElement("button");
  activador.className = "courses__card-hit-area";
  activador.type = "button";
  activador.setAttribute(
    "aria-label",
    `Ver detalles del curso: ${curso.titulo || "curso sin título"}`
  );
  activador.addEventListener("click", verMasInformacion);
  tarjeta.appendChild(activador);

  return tarjeta;
}

function agregarInformacionCurso(contenedor, tipo, etiqueta, valor) {
  if (!valor) return;

  const item = document.createElement("p");
  item.className = `courses__card-info-row courses__card-info-row--${tipo}`;

  const label = document.createElement("span");
  label.className = "courses__card-info-label";
  label.textContent = `${etiqueta}: `;

  const value = document.createElement("strong");
  value.className = "courses__card-info-value";
  value.textContent = valor;

  const texto = document.createElement("span");
  texto.className = "courses__card-info-text";
  texto.append(label, value);

  item.appendChild(texto);
  contenedor.appendChild(item);
}

function agregarChipCurso(contenedor, texto, modificador = null) {
  if (!texto) return;

  const chip = document.createElement("span");
  chip.className = "courses__card-chip";
  if (modificador) {
    chip.classList.add(`courses__card-chip--${modificador}`);
  }
  chip.textContent = texto;
  contenedor.appendChild(chip);
}

function crearFallbackCurso(media, curso) {
  media.replaceChildren();
  media.classList.add("courses__card-media--fallback");
  media.setAttribute("aria-hidden", "true");

  const mediaLabel = document.createElement("span");
  mediaLabel.className = "courses__card-media-label";
  mediaLabel.textContent = "TAUDUX / ACADEMY";

  const mediaTopic = document.createElement("span");
  mediaTopic.className = "courses__card-media-topic";
  mediaTopic.textContent = (curso.categoria || "Formación tecnológica").toUpperCase();

  media.append(mediaLabel, mediaTopic);
}

// Gate de sesión para el detalle del curso: sin sesión, avisa y manda a login;
// con sesión, el detalle real todavía no existe (placeholder, ver F-008).
async function verMasInformacion() {
  const session = await obtenerSesion();
  if (!session) {
    mostrarToast("Inicia sesión para ver más información.", "error");
    const destino = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.href = urlLoginConDestino(destino);
    return;
  }
  mostrarToast("El detalle del curso estará disponible pronto.");
}

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

// Tarjeta de solo lectura y activable: imagen, badges de modalidad/próximamente,
// título, descripción, horario y rango de fechas (omitidos si el curso es
// "próximamente") y cupo/costo — cada dato opcional solo si existe.
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

  const encabezado = document.createElement("div");
  encabezado.className = "courses__card-header";

  const badges = document.createElement("div");
  badges.className = "courses__badges";

  const badgeModalidad = etiquetaModalidad(curso);
  if (badgeModalidad) {
    const badgeEl = document.createElement("span");
    badgeEl.className = `courses__badge courses__badge--${curso.modalidad}`;
    badgeEl.textContent = badgeModalidad;
    badges.appendChild(badgeEl);
  }

  if (badges.childElementCount) {
    encabezado.appendChild(badges);
  }

  if (curso.proximamente) {
    const proximamenteEl = document.createElement("span");
    proximamenteEl.className = "courses__badge courses__badge--proximamente";
    proximamenteEl.textContent = "Próximamente";
    encabezado.appendChild(proximamenteEl);
  }

  if (encabezado.childElementCount) {
    cuerpo.appendChild(encabezado);
  }

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

  const metadatos = document.createElement("div");
  metadatos.className = "courses__card-meta-grid";

  if (!curso.proximamente) {
    const horario = formatearHorario(curso);
    agregarMetaCurso(metadatos, "Horario", horario);

    const rango = formatearRangoFechas(curso);
    agregarMetaCurso(metadatos, "Fechas", rango);
  }

  const costo = formatearCosto(curso.costo);
  agregarMetaCurso(metadatos, "Cupo", curso.cupo_maximo ? `${curso.cupo_maximo} lugares` : null);
  agregarMetaCurso(metadatos, "Inversión", costo);

  if (metadatos.childElementCount) {
    cuerpo.appendChild(metadatos);
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

function agregarMetaCurso(contenedor, etiqueta, valor) {
  if (!valor) return;

  const item = document.createElement("div");
  item.className = "courses__card-meta-item";

  const label = document.createElement("span");
  label.className = "courses__card-meta-label";
  label.textContent = `${etiqueta}:`;

  const value = document.createElement("strong");
  value.className = "courses__card-meta-value";
  value.textContent = valor;

  item.append(label, value);
  contenedor.appendChild(item);
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

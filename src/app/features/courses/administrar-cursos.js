/*
  Vista de cuadrícula del panel de administración de cursos. Requiere sesión y
  rol admin (admin-startup.js); RLS sigue siendo el gate real para escrituras.

  Título y categoría vienen de cursos.service.js (Supabase real, vía listarCursos()).
  El sello "Actualizado" sigue siendo placeholder: hoy la tabla `cursos` no tiene
  una columna de última actualización (solo `creado_en`). Cuando esa columna real
  exista, se reemplaza FECHAS_ACTUALIZACION_PLACEHOLDER por el campo real.

  Eliminar sigue inerte a propósito: es la acción irreversible, se conecta en un
  paso aparte. Editar sí navega al formulario real porque ya hay un id real detrás.
*/

const FECHAS_ACTUALIZACION_PLACEHOLDER = ["10 jul 2026", "22 jul 2026", "24 jul 2026"];

function crearTarjetaCursoAdmin(curso, indice) {
  const tarjeta = document.createElement("article");
  tarjeta.className = "courses__card panel";

  const media = document.createElement("div");
  media.className = "courses__card-media courses__card-media--fallback";
  media.setAttribute("aria-hidden", "true");

  const badge = document.createElement("span");
  badge.className = "courses__card-updated-badge";
  const fechaPlaceholder = FECHAS_ACTUALIZACION_PLACEHOLDER[
    indice % FECHAS_ACTUALIZACION_PLACEHOLDER.length
  ];
  badge.textContent = `Actualizado: ${fechaPlaceholder}`;

  const mediaLabel = document.createElement("span");
  mediaLabel.className = "courses__card-media-label";
  mediaLabel.textContent = "TAUDUX / ACADEMY";

  const mediaTopic = document.createElement("span");
  mediaTopic.className = "courses__card-media-topic";
  mediaTopic.textContent = (curso.categoria || "Formación tecnológica").toUpperCase();

  media.append(badge, mediaLabel, mediaTopic);
  tarjeta.appendChild(media);

  const cuerpo = document.createElement("div");
  cuerpo.className = "courses__card-body";

  const titulo = document.createElement("h2");
  titulo.className = "courses__card-title";
  titulo.textContent = curso.titulo;
  cuerpo.appendChild(titulo);

  const acciones = document.createElement("div");
  acciones.className = "courses__card-admin";

  const editar = document.createElement("a");
  editar.className = "button courses__action";
  editar.href = `/src/app/features/courses/editar-curso.html?id=${encodeURIComponent(curso.id)}`;
  editar.textContent = "Editar";

  const eliminar = document.createElement("button");
  eliminar.className = "button courses__action courses__action--danger";
  eliminar.type = "button";
  eliminar.textContent = "Eliminar";
  eliminar.addEventListener("click", () => mostrarToast(
    "Eliminar desde acá todavía no está conectado.",
    "success"
  ));

  acciones.append(editar, eliminar);
  cuerpo.appendChild(acciones);
  tarjeta.appendChild(cuerpo);

  return tarjeta;
}

function crearEstadoVacioAdmin(mensaje) {
  const vacio = document.createElement("p");
  vacio.className = "courses__empty";
  vacio.textContent = mensaje;
  return vacio;
}

(async () => {
  const arranque = crearArranqueAdmin({
    pagina: "course_admin_grid",
    tituloError: "No se pudo abrir la administración de cursos",
  });

  const inicioStartup = arranque.iniciarTiempo();
  if (!(await arranque.asegurarAdmin(inicioStartup))) return;

  const lista = document.getElementById("cursosAdminLista");

  let resultado;
  try {
    resultado = await listarCursos();
  } catch (error) {
    arranque.reportarFallo("course_admin_grid_load", error, inicioStartup, "list_exception");
    lista.appendChild(crearEstadoVacioAdmin("No se pudieron cargar los cursos. Intenta de nuevo más tarde."));
    arranque.revelar();
    return;
  }

  if (!resultado.ok) {
    arranque.reportarFallo("course_admin_grid_load", null, inicioStartup, resultado.codigo || "list_failed");
    lista.appendChild(crearEstadoVacioAdmin(resultado.mensaje || "No se pudieron cargar los cursos."));
  } else if (resultado.data.length === 0) {
    lista.appendChild(crearEstadoVacioAdmin("Aún no hay cursos publicados."));
  } else {
    resultado.data.forEach((curso, indice) => {
      lista.appendChild(crearTarjetaCursoAdmin(curso, indice));
    });
  }

  arranque.revelar();
})();

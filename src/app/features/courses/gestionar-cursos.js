/*
  Panel de gestión de cursos: alta, edición y borrado. Página admin-gated —
  requiere sesión Y rol admin; a un no-admin lo redirige al catálogo. La RLS de
  Postgres es el gate real de datos; esta guardia es solo UX. Depende de
  auth.service.js, cursos.service.js y toast.js (cargar antes que este archivo).
*/

(async () => {
  const session = await requerirSesion();
  if (!session) return;

  // Un no-admin no debe ver el panel; la RLS igual bloquearía la escritura.
  if (!(await esAdmin(session))) {
    window.location.href = "/src/app/features/courses/cursos.html";
    return;
  }

  const cuerpo = document.body;
  const lista = document.getElementById("cursosLista");
  const form = document.getElementById("cursoForm");
  const inputTitulo = document.getElementById("cursoTitulo");
  const inputCategoria = document.getElementById("cursoCategoria");
  const inputDescripcion = document.getElementById("cursoDescripcion");
  const inputModalidad = document.getElementById("cursoModalidad");
  const inputFechaInicio = document.getElementById("cursoFechaInicio");
  const inputFechaFin = document.getElementById("cursoFechaFin");
  const checksDias = Array.from(document.querySelectorAll(".courses__dias input"));
  const inputHora = document.getElementById("cursoHora");
  const inputDuracion = document.getElementById("cursoDuracion");
  const inputProximamente = document.getElementById("cursoProximamente");
  const inputCupo = document.getElementById("cursoCupo");
  const inputCosto = document.getElementById("cursoCosto");
  const inputInstructor = document.getElementById("cursoInstructor");
  const inputImagen = document.getElementById("cursoImagen");
  const botonEnviar = form.querySelector('button[type="submit"]');
  const botonCancelar = document.getElementById("cursoCancelar");

  // id del curso en edición; null significa que el form crea uno nuevo.
  let editandoId = null;

  form.addEventListener("submit", enviarFormulario);
  botonCancelar.addEventListener("click", limpiarFormulario);
  inputProximamente.addEventListener("change", actualizarObligatoriedadHorario);

  await pintarCursos();
  cuerpo.classList.remove("courses--auth-pending");
  actualizarObligatoriedadHorario();

  // Con "Próximamente" marcado, el curso aún no tiene horario definitivo: hora,
  // duración, fechas y días dejan de ser obligatorios (siguen siendo editables
  // por si ya se sabe parte del horario).
  function actualizarObligatoriedadHorario() {
    const requerido = !inputProximamente.checked;
    inputHora.required = requerido;
    inputDuracion.required = requerido;
    inputFechaInicio.required = requerido;
    inputFechaFin.required = requerido;
  }

  async function pintarCursos() {
    const resultado = await listarCursos();
    lista.textContent = "";
    if (!resultado.ok) {
      mostrarToast(resultado.mensaje, "error");
      return;
    }
    if (resultado.data.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "courses__empty";
      vacio.textContent = "Aún no hay cursos publicados.";
      lista.appendChild(vacio);
      return;
    }
    resultado.data.forEach((curso) => lista.appendChild(crearTarjetaGestion(curso)));
  }

  function crearTarjetaGestion(curso) {
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

    const adminAcciones = document.createElement("div");
    adminAcciones.className = "courses__card-admin";

    const editar = document.createElement("button");
    editar.className = "button courses__action";
    editar.type = "button";
    editar.textContent = "Editar";
    editar.addEventListener("click", () => cargarEnFormulario(curso));

    const borrar = document.createElement("button");
    borrar.className = "button courses__action courses__action--danger";
    borrar.type = "button";
    borrar.textContent = "Borrar";
    borrar.addEventListener("click", () => borrarCurso(curso));

    adminAcciones.appendChild(editar);
    adminAcciones.appendChild(borrar);
    tarjeta.appendChild(adminAcciones);

    return tarjeta;
  }

  function cargarEnFormulario(curso) {
    editandoId = curso.id;
    inputTitulo.value = curso.titulo || "";
    inputCategoria.value = curso.categoria || "";
    inputDescripcion.value = curso.descripcion || "";
    inputModalidad.value = curso.modalidad || "";
    inputFechaInicio.value = curso.fecha_inicio || "";
    inputFechaFin.value = curso.fecha_fin || "";
    inputProximamente.checked = Boolean(curso.proximamente);
    const dias = curso.dias_semana || [];
    checksDias.forEach((check) => (check.checked = dias.includes(check.value)));
    inputHora.value = curso.hora_inicio || "";
    inputDuracion.value = curso.duracion_horas || "";
    inputCupo.value = curso.cupo_maximo || "";
    inputCosto.value = curso.costo ?? "";
    inputInstructor.value = curso.instructor || "";
    inputImagen.value = curso.imagen_url || "";
    botonEnviar.textContent = "Guardar cambios";
    actualizarObligatoriedadHorario();
    form.scrollIntoView({ behavior: "smooth" });
  }

  function limpiarFormulario() {
    editandoId = null;
    form.reset();
    checksDias.forEach((check) => (check.checked = false));
    botonEnviar.textContent = "Publicar curso";
    actualizarObligatoriedadHorario();
  }

  async function enviarFormulario(evento) {
    evento.preventDefault();

    const diasSeleccionados = checksDias.filter((c) => c.checked).map((c) => c.value);
    if (!inputProximamente.checked && diasSeleccionados.length === 0) {
      mostrarToast("Selecciona al menos un día de la semana.", "error");
      return;
    }

    const datos = {
      titulo: inputTitulo.value.trim(),
      categoria: inputCategoria.value,
      descripcion: inputDescripcion.value.trim(),
      modalidad: inputModalidad.value,
      fecha_inicio: inputFechaInicio.value,
      fecha_fin: inputFechaFin.value,
      proximamente: inputProximamente.checked,
      dias_semana: diasSeleccionados,
      hora_inicio: inputHora.value,
      duracion_horas: inputDuracion.value,
      cupo_maximo: inputCupo.value,
      costo: inputCosto.value,
      instructor: inputInstructor.value.trim(),
      imagen_url: inputImagen.value.trim(),
    };

    const resultado = editandoId
      ? await actualizarCurso(editandoId, datos)
      : await crearCurso(datos);

    if (!resultado.ok) {
      mostrarToast(resultado.mensaje, "error");
      return;
    }
    mostrarToast(editandoId ? "Curso actualizado." : "Curso publicado.", "success");
    limpiarFormulario();
    await pintarCursos();
  }

  async function borrarCurso(curso) {
    if (!window.confirm(`¿Eliminar "${curso.titulo}"?`)) return;
    const resultado = await eliminarCurso(curso.id);
    if (!resultado.ok) {
      mostrarToast(resultado.mensaje, "error");
      return;
    }
    mostrarToast("Curso eliminado.", "success");
    await pintarCursos();
  }
})();

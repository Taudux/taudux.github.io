/*
  Página de cursos: la lista se muestra a cualquier usuario con sesión; el alta,
  edición y borrado solo se cablean si el usuario es administrador. Sigue el
  patrón de sesión de explorar.js. Depende de auth.service.js, cursos.service.js
  y toast.js (deben cargarse antes que este archivo).
*/

(async () => {
  const session = await requerirSesion();
  if (!session) return;

  const admin = await esAdmin(session);
  const cuerpo = document.body;
  const lista = document.getElementById("cursosLista");
  const form = document.getElementById("cursoForm");
  const inputTitulo = document.getElementById("cursoTitulo");
  const inputDescripcion = document.getElementById("cursoDescripcion");
  const inputEnlace = document.getElementById("cursoEnlace");
  const inputImagen = document.getElementById("cursoImagen");
  const botonEnviar = form.querySelector('button[type="submit"]');

  // id del curso en edición; null significa que el form crea uno nuevo.
  let editandoId = null;

  if (admin) {
    cuerpo.classList.add("courses--admin");
    form.addEventListener("submit", enviarFormulario);
  }

  await pintarCursos();
  cuerpo.classList.remove("courses--auth-pending");

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
    resultado.data.forEach((curso) => lista.appendChild(crearTarjeta(curso)));
  }

  function crearTarjeta(curso) {
    const tarjeta = document.createElement("article");
    tarjeta.className = "courses__card panel";

    // La imagen solo se pinta si su URL pasa el saneo http/https.
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

    if (admin) {
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
    }

    return tarjeta;
  }

  function cargarEnFormulario(curso) {
    editandoId = curso.id;
    inputTitulo.value = curso.titulo || "";
    inputDescripcion.value = curso.descripcion || "";
    inputEnlace.value = curso.enlace || "";
    inputImagen.value = curso.imagen_url || "";
    botonEnviar.textContent = "Guardar cambios";
    form.scrollIntoView({ behavior: "smooth" });
  }

  function limpiarFormulario() {
    editandoId = null;
    form.reset();
    botonEnviar.textContent = "Publicar curso";
  }

  async function enviarFormulario(evento) {
    evento.preventDefault();
    const datos = {
      titulo: inputTitulo.value.trim(),
      descripcion: inputDescripcion.value.trim(),
      enlace: inputEnlace.value.trim(),
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

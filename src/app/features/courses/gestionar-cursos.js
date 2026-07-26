/*
  Panel de gestión de cursos: alta, edición y borrado. Página admin-gated —
  requiere sesión Y rol admin; a un no-admin lo redirige al catálogo. La RLS de
  Postgres es el gate real de datos; esta guardia es solo UX. Depende de
  auth.service.js, categorias.service.js, cursos.service.js y toast.js (cargar antes).
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
  const panelCategorias = document.querySelector(".courses__categories-panel");
  const formCategoria = document.getElementById("categoriaForm");
  const inputNombreCategoria = document.getElementById("categoriaNombre");
  const botonAgregarCategoria = document.getElementById("categoriaAgregar");
  const estadoCategorias = document.getElementById("categoriasEstado");
  const mensajeEstadoCategorias = document.getElementById("categoriasEstadoMensaje");
  const botonReintentarCategorias = document.getElementById("categoriasReintentar");
  const listaCategorias = document.getElementById("categoriasLista");
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
  const controlesProgramacion = [inputHora, inputDuracion, inputFechaInicio, inputFechaFin];
  const inputCupo = document.getElementById("cursoCupo");
  const inputCosto = document.getElementById("cursoCosto");
  const inputInstructor = document.getElementById("cursoInstructor");
  const inputImagen = document.getElementById("cursoImagen");
  const botonEnviar = form.querySelector('button[type="submit"]');
  const botonCancelar = document.getElementById("cursoCancelar");

  // id del curso en edición; null significa que el form crea uno nuevo.
  let editandoId = null;
  let cursoEditando = null;
  let categorias = [];
  let modoCategorias = "cargando";
  let cargaCategoriasEnCurso = false;
  let mutacionCategoriaEnCurso = false;
  let secuenciaCargaCategorias = 0;
  let controlesCategorias = [];

  const VALOR_CATEGORIA_SIN_ASIGNAR = "__sin_categoria__";
  // Los valores con este prefijo nunca se envían como IDs; preservan texto legado
  // antes de 0010 y deben retirarse junto con la compatibilidad de fase 1.
  const PREFIJO_CATEGORIA_LEGACY = "__categoria_legacy__:";

  form.addEventListener("submit", enviarFormulario);
  formCategoria.addEventListener("submit", agregarCategoria);
  botonReintentarCategorias.addEventListener("click", reintentarCategorias);
  botonCancelar.addEventListener("click", limpiarFormulario);
  inputProximamente.addEventListener("change", actualizarEstadoProgramacion);

  await cargarCategorias();
  await pintarCursos();
  cuerpo.classList.remove("courses--auth-pending");
  actualizarEstadoProgramacion();

  // Un curso próximo no debe conservar una programación parcial o desactualizada.
  function actualizarEstadoProgramacion() {
    const esProximamente = inputProximamente.checked;
    controlesProgramacion.forEach((control) => {
      if (esProximamente) control.value = "";
      control.disabled = esProximamente;
      control.required = !esProximamente;
    });
    checksDias.forEach((check) => {
      if (esProximamente) check.checked = false;
      check.disabled = esProximamente;
    });
  }

  function registrarErrorControlador(contexto, error) {
    console.error("[gestionar-cursos]", { contexto, error });
  }

  async function pintarCursos({ preservarSeleccionCategoria = false } = {}) {
    const seleccionPrevia = preservarSeleccionCategoria ? obtenerSeleccionCategoria() : null;
    let resultado;
    try {
      resultado = await listarCursos();
    } catch (error) {
      registrarErrorControlador("listar-cursos", error);
      mostrarToast("No se pudieron cargar los cursos.", "error");
      return false;
    }
    if (!resultado.ok) {
      mostrarToast(resultado.mensaje, "error");
      return false;
    }

    if (resultado.modoCategorias === "legacy" && modoCategorias !== "normalizado") {
      incorporarCategoriasLegacy(resultado.data);
      pintarCategorias();
      poblarSelectCategorias(cursoEditando, seleccionPrevia);
    }

    lista.textContent = "";
    if (resultado.data.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "courses__empty";
      vacio.textContent = "Aún no hay cursos publicados.";
      lista.appendChild(vacio);
      return true;
    }
    if (editandoId) {
      cursoEditando = resultado.data.find((curso) => curso.id === editandoId) || cursoEditando;
      poblarSelectCategorias(cursoEditando, seleccionPrevia);
    }
    resultado.data.forEach((curso) => lista.appendChild(crearTarjetaGestion(curso)));
    return true;
  }

  function crearCategoriasLegacy(nombresExtra = []) {
    const nombres = [...CATEGORIAS_LEGACY_CURSO, ...nombresExtra]
      .map((nombre) => (typeof nombre === "string" ? nombre.trim() : ""))
      .filter(Boolean);
    return Array.from(new Map(nombres.map((nombre) => [nombre.toLocaleLowerCase("es-MX"), nombre])).values())
      .sort((a, b) => a.localeCompare(b, "es-MX"))
      .map((nombre) => ({
        id: null,
        nombre,
        activo: null,
        legacy: true,
      }));
  }

  function incorporarCategoriasLegacy(cursos) {
    const nombresActuales = categorias.map((categoria) => categoria.nombre);
    const nombresCursos = cursos.map((curso) => curso.categoria).filter(Boolean);
    categorias = crearCategoriasLegacy([...nombresActuales, ...nombresCursos]);
  }

  async function cargarCategorias({ focoId = null } = {}) {
    const solicitud = ++secuenciaCargaCategorias;
    const seleccionPrevia = obtenerSeleccionCategoria();
    const habiaDatos = categorias.length > 0;
    cargaCategoriasEnCurso = true;
    actualizarDisponibilidadCrudCategorias();

    let resultado;
    try {
      resultado = await listarCategorias({ incluirInactivas: true });
    } catch (error) {
      registrarErrorControlador("listar-categorias", error);
      resultado = { ok: false, mensaje: "No se pudieron cargar las categorías." };
    }

    if (solicitud !== secuenciaCargaCategorias) return false;

    if (resultado.ok) {
      categorias = resultado.data.map((categoria) => ({ ...categoria, legacy: false }));
      modoCategorias = "normalizado";
      ocultarEstadoCategorias();
      pintarCategorias();
      poblarSelectCategorias(cursoEditando, seleccionPrevia);
    } else if (resultado.migracionRequerida) {
      modoCategorias = "migracion";
      categorias = crearCategoriasLegacy(cursoEditando?.categoria ? [cursoEditando.categoria] : []);
      pintarCategorias();
      poblarSelectCategorias(cursoEditando, seleccionPrevia);
      mostrarEstadoCategorias(
        "migration",
        "Se requiere aplicar la migración 0010 en Supabase. Puedes seguir creando y editando cursos con las opciones heredadas; la administración de categorías queda deshabilitada."
      );
    } else {
      modoCategorias = "error";
      if (!habiaDatos) {
        categorias = crearCategoriasLegacy(cursoEditando?.categoria ? [cursoEditando.categoria] : []);
        pintarCategorias();
        poblarSelectCategorias(cursoEditando, seleccionPrevia);
      }
      mostrarEstadoCategorias(
        "error",
        "No se pudieron actualizar las categorías. Se conserva la última lista disponible; reintenta cuando tengas conexión."
      );
    }

    cargaCategoriasEnCurso = false;
    actualizarDisponibilidadCrudCategorias();
    if (focoId) restaurarFoco(focoId);
    return resultado.ok;
  }

  async function reintentarCategorias() {
    if (cargaCategoriasEnCurso || mutacionCategoriaEnCurso) return;
    const cargadas = await cargarCategorias();
    restaurarFoco(cargadas ? "categoriaNombre" : "categoriasEstado");
  }

  function mostrarEstadoCategorias(tipo, mensaje) {
    estadoCategorias.hidden = false;
    estadoCategorias.classList.remove(
      "courses__categories-status--migration",
      "courses__categories-status--error"
    );
    estadoCategorias.classList.add(`courses__categories-status--${tipo}`);
    mensajeEstadoCategorias.textContent = mensaje;
  }

  function ocultarEstadoCategorias() {
    estadoCategorias.hidden = true;
    mensajeEstadoCategorias.textContent = "";
    estadoCategorias.classList.remove(
      "courses__categories-status--migration",
      "courses__categories-status--error"
    );
  }

  function actualizarDisponibilidadCrudCategorias() {
    const ocupada = cargaCategoriasEnCurso || mutacionCategoriaEnCurso;
    const bloquearCrud = ocupada || modoCategorias !== "normalizado";
    panelCategorias.classList.toggle("courses__categories-panel--busy", ocupada);
    listaCategorias.setAttribute("aria-busy", String(ocupada));
    [inputNombreCategoria, botonAgregarCategoria, ...controlesCategorias].forEach((control) => {
      control.disabled = bloquearCrud;
    });
    botonReintentarCategorias.disabled = ocupada;
  }

  function pintarCategorias() {
    listaCategorias.textContent = "";
    controlesCategorias = [];
    if (categorias.length === 0) {
      const vacio = document.createElement("li");
      vacio.className = "courses__category-empty";
      vacio.textContent = "Aún no hay categorías. Puedes publicar el curso sin categoría.";
      listaCategorias.appendChild(vacio);
      actualizarDisponibilidadCrudCategorias();
      return;
    }

    categorias.forEach((categoria, indice) => {
      const item = document.createElement("li");
      item.className = "courses__category-item";
      const detalles = document.createElement("div");
      detalles.className = "courses__category-details";
      const campo = document.createElement("div");
      campo.className = "courses__field-group";
      const claveCategoria = categoria.id || `legacy-${indice}`;
      const idCampo = `categoria-${claveCategoria}`;
      const etiqueta = document.createElement("label");
      etiqueta.className = "courses__field-label";
      etiqueta.htmlFor = idCampo;
      etiqueta.textContent = categoria.legacy ? "Categoría heredada" : "Nombre de categoría";
      const nombre = document.createElement("input");
      nombre.className = "field";
      nombre.id = idCampo;
      nombre.type = "text";
      nombre.maxLength = LONGITUD_MAXIMA_CATEGORIA;
      nombre.value = categoria.nombre;
      campo.append(etiqueta, nombre);
      controlesCategorias.push(nombre);

      const estado = document.createElement("span");
      estado.className = "courses__category-status";
      if (categoria.legacy) {
        estado.textContent = modoCategorias === "migracion" ? "Opción heredada" : "Estado sin verificar";
      } else {
        if (!categoria.activo) estado.classList.add("courses__category-status--inactive");
        estado.textContent = categoria.activo ? "Activa" : "Inactiva";
      }
      detalles.append(campo, estado);

      const acciones = document.createElement("div");
      acciones.className = "courses__category-actions";
      if (!categoria.legacy) {
        const renombrar = crearBotonCategoria(
          "Renombrar",
          categoria,
          "renombrar"
        );
        renombrar.addEventListener("click", () => guardarNombreCategoria(categoria, nombre, renombrar));
        const cambiarEstado = crearBotonCategoria(
          categoria.activo ? "Desactivar" : "Reactivar",
          categoria,
          "estado"
        );
        cambiarEstado.addEventListener("click", () => cambiarEstadoCategoria(categoria));
        const retirar = crearBotonCategoria("Retirar", categoria, "retirar", true);
        retirar.addEventListener("click", () => confirmarRetiroCategoria(categoria, retirar));
        acciones.append(renombrar, cambiarEstado, retirar);
        controlesCategorias.push(renombrar, cambiarEstado, retirar);
      }

      item.append(detalles, acciones);
      listaCategorias.appendChild(item);
    });
    actualizarDisponibilidadCrudCategorias();
  }

  function crearBotonCategoria(texto, categoria, accion, destructivo = false) {
    const boton = document.createElement("button");
    boton.className = "button courses__category-action";
    if (destructivo) boton.classList.add("courses__category-action--danger");
    boton.id = `categoria-${accion}-${categoria.id}`;
    boton.type = "button";
    boton.textContent = texto;
    boton.setAttribute("aria-label", `${texto} categoría ${categoria.nombre}`);
    return boton;
  }

  function crearOpcionCategoria(valor, nombre, modo, texto = nombre) {
    const opcion = document.createElement("option");
    opcion.value = valor;
    opcion.textContent = texto;
    opcion.dataset.nombre = nombre || "";
    opcion.dataset.modo = modo;
    return opcion;
  }

  function poblarSelectCategorias(cursoActual = null, seleccionPreferida = null) {
    inputCategoria.textContent = "";
    inputCategoria.appendChild(
      crearOpcionCategoria(VALOR_CATEGORIA_SIN_ASIGNAR, "", "ninguna", "Sin categoría")
    );

    const activas = categorias.filter((categoria) => categoria.legacy || categoria.activo);
    activas.forEach((categoria) => {
      const modo = categoria.legacy ? "legacy" : "normalizado";
      const valor = categoria.legacy
        ? `${PREFIJO_CATEGORIA_LEGACY}${encodeURIComponent(categoria.nombre)}`
        : categoria.id;
      inputCategoria.appendChild(crearOpcionCategoria(valor, categoria.nombre, modo));
    });

    const idActual = cursoActual?.categoria_id || null;
    const categoriaActual = idActual
      ? categorias.find((categoria) => categoria.id === idActual) || cursoActual.categoria_rel
      : null;
    if (categoriaActual && !activas.some((categoria) => categoria.id === idActual)) {
      const textoActual = categoriaActual.activo === false
        ? `${categoriaActual.nombre} (inactiva)`
        : categoriaActual.nombre;
      inputCategoria.appendChild(
        crearOpcionCategoria(
          idActual,
          categoriaActual.nombre,
          "normalizado",
          textoActual
        )
      );
    }

    if (cursoActual?.categoria && !opcionCategoriaPorNombre(cursoActual.categoria)) {
      inputCategoria.appendChild(
        crearOpcionCategoria(
          `${PREFIJO_CATEGORIA_LEGACY}${encodeURIComponent(cursoActual.categoria)}`,
          cursoActual.categoria,
          "legacy",
          `${cursoActual.categoria} (heredada)`
        )
      );
    }

    const opcionPreferida = buscarOpcionCompatible(seleccionPreferida);
    const opcionActual = idActual
      ? Array.from(inputCategoria.options).find((opcion) => opcion.value === idActual)
      : opcionCategoriaPorNombre(cursoActual?.categoria);
    inputCategoria.value =
      (opcionPreferida || opcionActual)?.value || VALOR_CATEGORIA_SIN_ASIGNAR;
    inputCategoria.disabled = false;
  }

  function opcionCategoriaPorNombre(nombre) {
    if (!nombre) return null;
    return Array.from(inputCategoria.options).find(
      (opcion) => opcion.dataset.nombre.toLocaleLowerCase("es-MX") === nombre.toLocaleLowerCase("es-MX")
    );
  }

  function buscarOpcionCompatible(seleccion) {
    if (!seleccion) return null;
    const opciones = Array.from(inputCategoria.options);
    return (
      opciones.find((opcion) => opcion.value === seleccion.valor) ||
      opciones.find(
        (opcion) =>
          seleccion.nombre &&
          opcion.dataset.nombre.toLocaleLowerCase("es-MX") ===
            seleccion.nombre.toLocaleLowerCase("es-MX")
      ) ||
      null
    );
  }

  function obtenerSeleccionCategoria() {
    const opcion = Array.from(inputCategoria.options || []).find(
      (candidata) => candidata.value === inputCategoria.value
    );
    if (!opcion) return null;
    return {
      valor: opcion.value,
      nombre: opcion.dataset.nombre || null,
      modo: opcion.dataset.modo,
    };
  }

  function obtenerDatosCategoriaFormulario() {
    const seleccion = obtenerSeleccionCategoria();
    const ninguna = !seleccion || seleccion.modo === "ninguna";
    const modo = seleccion?.modo === "legacy"
      ? "legacy"
      : seleccion?.modo === "normalizado" || modoCategorias === "normalizado"
        ? "normalizado"
        : "legacy";
    return {
      categoria_id: ninguna || seleccion.modo !== "normalizado" ? null : seleccion.valor,
      categoria: ninguna ? null : seleccion.nombre,
      categoria_modo: modo,
    };
  }

  function iniciarMutacionCategoria() {
    if (mutacionCategoriaEnCurso || cargaCategoriasEnCurso || modoCategorias !== "normalizado") {
      return false;
    }
    mutacionCategoriaEnCurso = true;
    actualizarDisponibilidadCrudCategorias();
    return true;
  }

  function finalizarMutacionCategoria(focoId) {
    mutacionCategoriaEnCurso = false;
    actualizarDisponibilidadCrudCategorias();
    restaurarFoco(focoId);
  }

  function restaurarFoco(id) {
    const destino = document.getElementById(id) || inputNombreCategoria;
    destino.focus();
  }

  async function agregarCategoria(evento) {
    evento.preventDefault();
    if (!iniciarMutacionCategoria()) return;
    let focoId = "categoriaNombre";
    try {
      const resultado = await crearCategoria(inputNombreCategoria.value);
      if (!resultado.ok) {
        mostrarToast(resultado.mensaje, "error");
        if (resultado.migracionRequerida) await cargarCategorias();
        return;
      }
      formCategoria.reset();
      mostrarToast("Categoría agregada.", "success");
      focoId = `categoria-${resultado.data.id}`;
      await cargarCategorias();
    } catch (error) {
      registrarErrorControlador("crear-categoria", error);
      mostrarToast("No se pudo crear la categoría.", "error");
    } finally {
      finalizarMutacionCategoria(focoId);
    }
  }

  async function guardarNombreCategoria(categoria, input, boton) {
    if (!iniciarMutacionCategoria()) return;
    let focoId = boton.id;
    try {
      const resultado = await renombrarCategoria(categoria.id, input.value);
      if (!resultado.ok) {
        mostrarToast(resultado.mensaje, "error");
        if (resultado.migracionRequerida) await cargarCategorias();
        return;
      }
      mostrarToast("Categoría renombrada.", "success");
      focoId = `categoria-${categoria.id}`;
      const cargadas = await cargarCategorias();
      if (cargadas) await pintarCursos({ preservarSeleccionCategoria: true });
    } catch (error) {
      registrarErrorControlador("renombrar-categoria", error);
      mostrarToast("No se pudo renombrar la categoría.", "error");
    } finally {
      finalizarMutacionCategoria(focoId);
    }
  }

  async function cambiarEstadoCategoria(categoria) {
    if (
      categoria.activo &&
      !window.confirm(`¿Desactivar la categoría "${categoria.nombre}" para cursos nuevos?`)
    ) {
      return;
    }
    if (!iniciarMutacionCategoria()) return;
    try {
      const resultado = await establecerCategoriaActiva(categoria.id, !categoria.activo);
      if (!resultado.ok) {
        mostrarToast(resultado.mensaje, "error");
        if (resultado.migracionRequerida) await cargarCategorias();
        return;
      }
      mostrarToast(categoria.activo ? "Categoría desactivada." : "Categoría reactivada.", "success");
      await cargarCategorias();
    } catch (error) {
      registrarErrorControlador("cambiar-estado-categoria", error);
      mostrarToast("No se pudo cambiar el estado de la categoría.", "error");
    } finally {
      finalizarMutacionCategoria(`categoria-estado-${categoria.id}`);
    }
  }

  async function confirmarRetiroCategoria(categoria, boton) {
    const confirmar = window.confirm(
      `¿Retirar la categoría "${categoria.nombre}"? Si algún curso la usa, se desactivará; si no, se eliminará definitivamente.`
    );
    if (!confirmar || !iniciarMutacionCategoria()) return;
    let focoId = boton.id;
    try {
      const resultado = await retirarCategoria(categoria.id);
      if (!resultado.ok) {
        mostrarToast(resultado.mensaje, "error");
        if (resultado.migracionRequerida) await cargarCategorias();
        return;
      }
      if (resultado.accion === "eliminada") {
        mostrarToast("Categoría sin cursos eliminada.", "success");
        focoId = "categoriaNombre";
      } else {
        const cantidad = resultado.referenciasExactas
          ? `${resultado.referencias} curso${resultado.referencias === 1 ? "" : "s"}`
          : `al menos ${resultado.referencias} curso`;
        mostrarToast(`Categoría en uso desactivada (${cantidad}).`, "success");
        focoId = `categoria-estado-${categoria.id}`;
      }
      await cargarCategorias();
    } catch (error) {
      registrarErrorControlador("retirar-categoria", error);
      mostrarToast("No se pudo retirar la categoría.", "error");
    } finally {
      finalizarMutacionCategoria(focoId);
    }
  }

  function crearTarjetaGestion(curso) {
    const tarjeta = document.createElement("article");
    tarjeta.className = "courses__card panel";

    if (curso.imagen_url && esUrlSegura(curso.imagen_url)) {
      const img = document.createElement("img");
      img.className = "courses__card-image";
      img.src = curso.imagen_url;
      img.alt = curso.titulo ? `Imagen del curso: ${curso.titulo}` : "Imagen del curso";
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
    cursoEditando = curso;
    inputTitulo.value = curso.titulo || "";
    poblarSelectCategorias(curso);
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
    actualizarEstadoProgramacion();
    form.scrollIntoView({ behavior: "smooth" });
  }

  function limpiarFormulario() {
    editandoId = null;
    cursoEditando = null;
    form.reset();
    checksDias.forEach((check) => (check.checked = false));
    botonEnviar.textContent = "Publicar curso";
    poblarSelectCategorias();
    actualizarEstadoProgramacion();
  }

  async function enviarFormulario(evento) {
    evento.preventDefault();

    const diasSeleccionados = checksDias.filter((c) => c.checked).map((c) => c.value);
    if (!inputProximamente.checked && diasSeleccionados.length === 0) {
      mostrarToast("Selecciona al menos un día de la semana.", "error");
      return;
    }
    const datosCategoria = obtenerDatosCategoriaFormulario();

    const datos = {
      titulo: inputTitulo.value.trim(),
      ...datosCategoria,
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

/*
  El <select> de categorías del formulario de curso. Concentra la parte más
  delicada de la pantalla: convivir con dos esquemas a la vez.

  - "normalizado": la categoría es una fila de public.categorias y viaja por
    categoria_id (migración 0010 aplicada).
  - "legacy": la categoría es solo texto en la columna cursos.categoria.

  El control conserva la selección del usuario entre recargas de la lista y
  nunca pierde la categoría que el curso ya tenía, aunque esté inactiva o ya no
  exista en el catálogo.

  Depende de categorias.service.js.
*/

const VALOR_CATEGORIA_SIN_ASIGNAR = "__sin_categoria__";
const PREFIJO_CATEGORIA_LEGACY = "__categoria_legacy__:";
const LOCALE_CATEGORIA = "es-MX";

function valorCategoriaLegacy(nombre) {
  return `${PREFIJO_CATEGORIA_LEGACY}${encodeURIComponent(nombre)}`;
}

function mismoNombreCategoria(a, b) {
  return Boolean(a) && Boolean(b) &&
    a.toLocaleLowerCase(LOCALE_CATEGORIA) === b.toLocaleLowerCase(LOCALE_CATEGORIA);
}

function crearControlCategoriasCurso(select) {
  let categorias = [];

  function crearOpcion(valor, nombre, modo, texto = nombre) {
    const opcion = document.createElement("option");
    opcion.value = valor;
    opcion.textContent = texto;
    opcion.dataset.nombre = nombre || "";
    opcion.dataset.modo = modo;
    return opcion;
  }

  const opciones = () => Array.from(select.options || []);

  function opcionPorNombre(nombre) {
    if (!nombre) return null;
    return opciones().find((opcion) => mismoNombreCategoria(opcion.dataset.nombre, nombre)) || null;
  }

  // Reencuentra la selección previa tras recargar la lista: primero por valor
  // exacto, y si el ID cambió de forma (legacy ⇄ normalizado), por nombre.
  function buscarOpcionCompatible(seleccion) {
    if (!seleccion) return null;
    return opciones().find((opcion) => opcion.value === seleccion.valor) ||
      opcionPorNombre(seleccion.nombre);
  }

  function agregarActivas() {
    const activas = categorias.filter((categoria) => categoria.legacy || categoria.activo);
    activas.forEach((categoria) => {
      const valor = categoria.legacy ? valorCategoriaLegacy(categoria.nombre) : categoria.id;
      const modo = categoria.legacy ? "legacy" : "normalizado";
      select.appendChild(crearOpcion(valor, categoria.nombre, modo));
    });
    return activas;
  }

  // La categoría del curso debe seguir siendo elegible aunque ya no esté activa,
  // o el usuario la perdería al guardar sin haberla tocado.
  function agregarCategoriaDelCurso(cursoActual, activas) {
    const idActual = cursoActual?.categoria_id || null;
    if (!idActual) return;
    const yaListada = activas.some((categoria) => categoria.id === idActual);
    if (yaListada) return;
    const actual = categorias.find((categoria) => categoria.id === idActual) || cursoActual.categoria_rel;
    if (!actual) return;
    const texto = actual.activo === false ? `${actual.nombre} (inactiva)` : actual.nombre;
    select.appendChild(crearOpcion(idActual, actual.nombre, "normalizado", texto));
  }

  function agregarCategoriaHeredada(cursoActual) {
    if (!cursoActual?.categoria || opcionPorNombre(cursoActual.categoria)) return;
    select.appendChild(crearOpcion(
      valorCategoriaLegacy(cursoActual.categoria),
      cursoActual.categoria,
      "legacy",
      `${cursoActual.categoria} (heredada)`
    ));
  }

  function seleccionar(cursoActual, seleccionPreferida) {
    const idActual = cursoActual?.categoria_id || null;
    const opcionActual = idActual
      ? opciones().find((opcion) => opcion.value === idActual)
      : opcionPorNombre(cursoActual?.categoria);
    const elegida = buscarOpcionCompatible(seleccionPreferida) || opcionActual;
    select.value = elegida?.value || VALOR_CATEGORIA_SIN_ASIGNAR;
  }

  return Object.freeze({
    reemplazarCategorias(nuevas) {
      categorias = nuevas;
    },

    obtenerSeleccion() {
      const opcion = opciones().find((candidata) => candidata.value === select.value);
      if (!opcion) return null;
      return {
        valor: opcion.value,
        nombre: opcion.dataset.nombre || null,
        modo: opcion.dataset.modo,
      };
    },

    poblar(cursoActual = null, seleccionPreferida = null) {
      select.textContent = "";
      select.appendChild(crearOpcion(VALOR_CATEGORIA_SIN_ASIGNAR, "", "ninguna", "Sin categoría"));
      const activas = agregarActivas();
      agregarCategoriaDelCurso(cursoActual, activas);
      agregarCategoriaHeredada(cursoActual);
      seleccionar(cursoActual, seleccionPreferida);
      select.disabled = false;
    },

    /*
      Traduce la selección a las columnas que espera el servicio. Sin categoría
      manda ambas en null; en modo legacy solo viaja el nombre, porque
      categoria_id no existe o no aplica.
    */
    datosParaEnvio(modoCategoriasPantalla) {
      const pantallaNormalizada = modoCategoriasPantalla === "normalizado";
      const seleccion = this.obtenerSeleccion();
      const sinCategoria = !seleccion || seleccion.modo === "ninguna";
      if (sinCategoria) {
        return {
          categoria_id: null,
          categoria: null,
          categoria_modo: pantallaNormalizada ? "normalizado" : "legacy",
        };
      }
      const esNormalizada = seleccion.modo === "normalizado";
      return {
        categoria_id: esNormalizada ? seleccion.valor : null,
        categoria: seleccion.nombre,
        categoria_modo: esNormalizada ? "normalizado" : "legacy",
      };
    },
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    VALOR_CATEGORIA_SIN_ASIGNAR,
    PREFIJO_CATEGORIA_LEGACY,
    crearControlCategoriasCurso,
  });
}

/*
  El editor del temario del curso: una lista de módulos en orden de dictado,
  cada uno con título, subtítulo y sus temas. Es el único grupo repetible del
  formulario, así que construye y destruye sus propios controles en vez de
  poblar controles que ya existen en el HTML.

  Dos cosas que no son obvias y que este control tiene que respetar:

  - Agregar o eliminar una fila es un click en un <button>, y un click no
    dispara `input` ni `change`. La delegación del formulario en
    gestionar-curso.js no se entera, así que el borrador automático y la clave
    de idempotencia del guardado se quedarían desactualizados. Por eso existe
    `alCambiar`: el controlador lo cablea a lo que necesita invalidar.

  - `firmaSolicitud` (gestionar-curso.js) compara el formulario con
    JSON.stringify, que es sensible al orden de las claves. Los objetos de
    módulo se arman siempre con el mismo literal y en el mismo orden, o el
    formulario se creería sucio sin que el usuario tocara nada.

  No depende de Supabase ni conoce el esquema: entrega y recibe la misma forma
  que guarda la columna `cursos.temario`.
*/

const TEMAS_INICIALES_POR_MODULO = 3;

// El temario puede venir de la base o de un borrador restaurado de hace 24 h,
// que solo se valida por fuera (ver leerBorrador en gestionar-curso.borrador.js).
// Nada de lo que llegue acá se asume bien formado.
function normalizarModuloTemario(modulo) {
  if (!modulo || typeof modulo !== "object") return null;
  return {
    titulo: typeof modulo.titulo === "string" ? modulo.titulo : "",
    subtitulo: typeof modulo.subtitulo === "string" ? modulo.subtitulo : "",
    temas: Array.isArray(modulo.temas)
      ? modulo.temas.filter((tema) => typeof tema === "string")
      : [],
  };
}

function normalizarTemario(temario) {
  if (!Array.isArray(temario)) return [];
  return temario.map(normalizarModuloTemario).filter(Boolean);
}

function crearControlTemarioCurso({ contenedor, botonAgregar, alCambiar = () => {} }) {
  function crearCampo(etiquetaTexto, control) {
    const grupo = document.createElement("div");
    grupo.className = "courses__field-group";
    const etiqueta = document.createElement("label");
    etiqueta.className = "courses__field-label";
    etiqueta.textContent = etiquetaTexto;
    // Sin ids únicos que mantener: el <label> envuelve a su control, que es
    // asociación válida y no se rompe al reordenar o eliminar filas.
    etiqueta.appendChild(control);
    grupo.appendChild(etiqueta);
    return grupo;
  }

  function crearTema(valor = "") {
    const fila = document.createElement("li");
    fila.className = "courses__tema";

    const entrada = document.createElement("input");
    entrada.className = "field courses__tema-campo";
    entrada.type = "text";
    entrada.value = valor;
    entrada.placeholder = "Tema";
    entrada.setAttribute("aria-label", "Tema del módulo");

    const quitar = document.createElement("button");
    quitar.className = "button button--outline courses__tema-quitar";
    quitar.type = "button";
    quitar.textContent = "×";
    quitar.setAttribute("aria-label", "Quitar este tema");
    quitar.addEventListener("click", () => {
      fila.remove();
      alCambiar();
    });

    fila.append(entrada, quitar);
    return fila;
  }

  function crearModulo(datos = { titulo: "", subtitulo: "", temas: [] }) {
    const modulo = document.createElement("article");
    modulo.className = "courses__modulo panel";

    const encabezado = document.createElement("div");
    encabezado.className = "courses__modulo-encabezado";

    const numero = document.createElement("span");
    numero.className = "courses__modulo-numero";

    const eliminar = document.createElement("button");
    eliminar.className = "button button--outline courses__modulo-eliminar";
    eliminar.type = "button";
    eliminar.textContent = "Eliminar módulo";
    eliminar.addEventListener("click", () => {
      modulo.remove();
      renumerar();
      alCambiar();
    });

    encabezado.append(numero, eliminar);

    const inputTitulo = document.createElement("input");
    inputTitulo.className = "field";
    inputTitulo.type = "text";
    inputTitulo.value = datos.titulo;
    inputTitulo.placeholder = "Título del módulo";
    inputTitulo.dataset.campo = "titulo";

    const inputSubtitulo = document.createElement("input");
    inputSubtitulo.className = "field";
    inputSubtitulo.type = "text";
    inputSubtitulo.value = datos.subtitulo;
    inputSubtitulo.placeholder = "Una línea que resuma el módulo";
    inputSubtitulo.dataset.campo = "subtitulo";

    const temas = document.createElement("ul");
    temas.className = "courses__temas";
    const temasIniciales = datos.temas.length
      ? datos.temas
      : Array.from({ length: TEMAS_INICIALES_POR_MODULO }, () => "");
    temasIniciales.forEach((tema) => temas.appendChild(crearTema(tema)));

    const agregarTema = document.createElement("button");
    agregarTema.className = "button button--outline courses__tema-agregar";
    agregarTema.type = "button";
    agregarTema.textContent = "Agregar tema";
    agregarTema.addEventListener("click", () => {
      temas.appendChild(crearTema());
      alCambiar();
    });

    modulo.append(
      encabezado,
      crearCampo("Título del módulo", inputTitulo),
      crearCampo("Subtítulo", inputSubtitulo),
      temas,
      agregarTema
    );
    return modulo;
  }

  const modulos = () => Array.from(contenedor.children);

  // El número es solo presentación: el orden real es el del DOM, y es el que
  // se guarda. Se recalcula al eliminar para que no queden huecos.
  function renumerar() {
    modulos().forEach((modulo, indice) => {
      const posicion = String(indice + 1).padStart(2, "0");
      const numero = modulo.querySelector(".courses__modulo-numero");
      if (numero) numero.textContent = posicion;
      const eliminar = modulo.querySelector(".courses__modulo-eliminar");
      if (eliminar) eliminar.setAttribute("aria-label", `Eliminar el módulo ${posicion}`);
    });
  }

  function leerModulo(modulo) {
    const valorDe = (campo) => {
      const control = modulo.querySelector(`[data-campo="${campo}"]`);
      return control ? control.value.trim() : "";
    };
    const temas = Array.from(modulo.querySelectorAll(".courses__tema-campo"))
      .map((entrada) => entrada.value.trim())
      .filter(Boolean);
    // Orden de claves fijo: lo consume JSON.stringify en firmaSolicitud.
    return { titulo: valorDe("titulo"), subtitulo: valorDe("subtitulo"), temas };
  }

  if (botonAgregar) {
    botonAgregar.addEventListener("click", () => {
      contenedor.appendChild(crearModulo());
      renumerar();
      alCambiar();
    });
  }

  return Object.freeze({
    /*
      Reconstruye las filas desde cero. A diferencia del resto del formulario,
      acá no alcanza con asignar valores: la cantidad de controles depende del
      dato. Recibe tanto la fila del servidor como un borrador restaurado.
    */
    poblar(curso = null) {
      contenedor.textContent = "";
      normalizarTemario(curso?.temario).forEach((modulo) => {
        contenedor.appendChild(crearModulo(modulo));
      });
      renumerar();
    },

    limpiar() {
      contenedor.textContent = "";
    },

    /*
      Un módulo sin título no es un módulo, es una fila que el usuario abrió y
      no llenó: se descarta entera en vez de guardar basura. Los temas vacíos
      ya se filtran al leer.
    */
    datosParaEnvio() {
      const temario = modulos().map(leerModulo).filter((modulo) => modulo.titulo);
      return { temario };
    },
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    TEMAS_INICIALES_POR_MODULO,
    normalizarTemario,
    crearControlTemarioCurso,
  });
}

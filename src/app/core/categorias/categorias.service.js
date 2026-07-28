/*
  Servicio de datos de categorías de curso. Depende de supabaseClient y debe
  cargarse después de él. RLS restringe las escrituras a administradores.
*/

const LONGITUD_MAXIMA_CATEGORIA = 80;
const CATEGORIAS_LEGACY_CURSO = Object.freeze([
  "Inteligencia artificial",
  "Análisis de datos",
]);
let disponibilidadCategoriasNormalizadas = null;

function obtenerDisponibilidadCategoriasNormalizadas() {
  return disponibilidadCategoriasNormalizadas;
}

/*
  Opciones que se ofrecen cuando public.categorias no está disponible: las
  heredadas más las que ya traiga el curso en edición, sin repetir nombres que
  solo difieran en mayúsculas y ordenadas como las vería un lector en español.
*/
function categoriasLegacy(nombresExtra = []) {
  const nombres = [...CATEGORIAS_LEGACY_CURSO, ...nombresExtra]
    .map((nombre) => (typeof nombre === "string" ? nombre.trim() : ""))
    .filter(Boolean);
  const unicas = new Map(nombres.map((nombre) => [nombre.toLocaleLowerCase("es-MX"), nombre]));
  return [...unicas.values()]
    .sort((a, b) => a.localeCompare(b, "es-MX"))
    .map((nombre) => ({ id: null, nombre, activo: null, legacy: true }));
}

function datosErrorSupabase(error) {
  return {
    code: error?.code || null,
    message: error?.message || null,
    details: error?.details || null,
    hint: error?.hint || null,
  };
}

function registrarErrorSupabaseCategorias(contexto, error, datos = {}) {
  console.error("[categorias.service]", {
    contexto,
    ...datos,
    error: datosErrorSupabase(error),
  });
}

// Solo clasifica la ausencia concreta de public.categorias. Errores de red,
// permisos o cualquier otra tabla siguen su flujo de error normal.
function esErrorTablaCategoriasAusente(error) {
  const code = error?.code;
  const texto = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  const mencionaCategorias =
    texto.includes("public.categorias") ||
    texto.includes('relation "categorias"') ||
    texto.includes("table 'public.categorias'") ||
    texto.includes('table "public.categorias"');

  return mencionaCategorias && (code === "42P01" || code === "PGRST205");
}

function esErrorCategoriaIdAusente(error) {
  const texto = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return (
    (error?.code === "42703" || error?.code === "PGRST204") &&
    texto.includes("categoria_id")
  );
}

function validarNombreCategoria(nombre) {
  const nombreNormalizado = typeof nombre === "string" ? nombre.trim() : "";
  if (!nombreNormalizado) {
    return { ok: false, mensaje: "El nombre de la categoría es obligatorio." };
  }
  // String iteration counts Unicode code points, matching PostgreSQL char_length
  // more closely than UTF-16 .length for astral characters.
  if ([...nombreNormalizado].length > LONGITUD_MAXIMA_CATEGORIA) {
    return {
      ok: false,
      mensaje: `El nombre no puede exceder ${LONGITUD_MAXIMA_CATEGORIA} caracteres.`,
    };
  }
  return { ok: true, nombre: nombreNormalizado };
}

function mensajeErrorCategoria(error, mensajePredeterminado) {
  if (error && error.code === "23505") {
    return "Ya existe una categoría con ese nombre.";
  }
  if (error && error.code === "23514") {
    return "El nombre de la categoría no es válido.";
  }
  return mensajePredeterminado;
}

/*
  Toda escritura de categorías cierra igual: si Supabase falló, se registra, se
  detecta si la causa fue la migración 0010 pendiente y se traduce el error a un
  mensaje para el usuario. Si salió bien, deja constancia de que el esquema
  normalizado existe.
*/
function resolverMutacionCategoria({ contexto, resultado, mensajeError, datos = {}, traducirError = true }) {
  const { data, error } = resultado;
  if (!error) {
    disponibilidadCategoriasNormalizadas = true;
    return { ok: true, data };
  }

  registrarErrorSupabaseCategorias(contexto, error, datos);
  const migracionRequerida = esErrorTablaCategoriasAusente(error);
  if (migracionRequerida) disponibilidadCategoriasNormalizadas = false;
  return {
    ok: false,
    mensaje: traducirError ? mensajeErrorCategoria(error, mensajeError) : mensajeError,
    migracionRequerida,
  };
}

const CAMPOS_CATEGORIA = "id, nombre, activo, creado_en, actualizado_en";

async function listarCategorias({ incluirInactivas = false } = {}) {
  let consulta = supabaseClient
    .from("categorias")
    .select(CAMPOS_CATEGORIA)
    .order("nombre", { ascending: true });

  if (!incluirInactivas) consulta = consulta.eq("activo", true);

  const { data, error } = await consulta;
  if (error) {
    registrarErrorSupabaseCategorias("listar", error, { incluirInactivas });
    if (esErrorTablaCategoriasAusente(error)) {
      disponibilidadCategoriasNormalizadas = false;
      return {
        ok: false,
        migracionRequerida: true,
        mensaje: "Se requiere aplicar la migración 0010 para administrar categorías.",
      };
    }
    return { ok: false, mensaje: "No se pudieron cargar las categorías." };
  }
  disponibilidadCategoriasNormalizadas = true;
  return { ok: true, data };
}

async function crearCategoria(nombre) {
  const validacion = validarNombreCategoria(nombre);
  if (!validacion.ok) return validacion;

  return resolverMutacionCategoria({
    contexto: "crear",
    mensajeError: "No se pudo crear la categoría.",
    resultado: await supabaseClient
      .from("categorias")
      .insert({ nombre: validacion.nombre })
      .select(CAMPOS_CATEGORIA)
      .single(),
  });
}

async function renombrarCategoria(id, nombre) {
  const validacion = validarNombreCategoria(nombre);
  if (!validacion.ok) return validacion;

  return resolverMutacionCategoria({
    contexto: "renombrar",
    mensajeError: "No se pudo renombrar la categoría.",
    datos: { categoriaId: id },
    resultado: await supabaseClient
      .from("categorias")
      .update({ nombre: validacion.nombre })
      .eq("id", id)
      .select(CAMPOS_CATEGORIA)
      .single(),
  });
}

async function establecerCategoriaActiva(id, activo) {
  return resolverMutacionCategoria({
    contexto: "cambiar-estado",
    mensajeError: "No se pudo cambiar el estado de la categoría.",
    datos: { categoriaId: id, activo },
    // Cambiar el estado no puede chocar con el índice único de nombre, así que
    // el mensaje predeterminado ya es el correcto.
    traducirError: false,
    resultado: await supabaseClient
      .from("categorias")
      .update({ activo: Boolean(activo) })
      .eq("id", id)
      .select(CAMPOS_CATEGORIA)
      .single(),
  });
}

async function desactivarCategoriaReferenciada(id, referencias, referenciasExactas = true) {
  const resultado = await establecerCategoriaActiva(id, false);
  if (!resultado.ok) return resultado;
  return {
    ok: true,
    accion: "desactivada",
    referencias,
    referenciasExactas,
    data: resultado.data,
  };
}

async function retirarCategoria(id) {
  const { count, error: errorConteo } = await supabaseClient
    .from("cursos")
    .select("id", { count: "exact", head: true })
    .eq("categoria_id", id);

  if (errorConteo) {
    registrarErrorSupabaseCategorias("contar-referencias", errorConteo, { categoriaId: id });
    const migracionRequerida = esErrorCategoriaIdAusente(errorConteo);
    if (migracionRequerida) disponibilidadCategoriasNormalizadas = false;
    return {
      ok: false,
      mensaje: "No se pudo comprobar si la categoría está en uso.",
      migracionRequerida,
    };
  }
  if (count > 0) return desactivarCategoriaReferenciada(id, count);

  const { error: errorBorrado } = await supabaseClient.from("categorias").delete().eq("id", id);
  if (!errorBorrado) {
    return { ok: true, accion: "eliminada", referencias: 0, referenciasExactas: true };
  }

  // Un curso pudo referenciarla entre el conteo y el DELETE. La FK RESTRICT
  // conserva el curso. En esa carrera solo sabemos que existe al menos una referencia.
  if (errorBorrado.code === "23503") {
    registrarErrorSupabaseCategorias("borrar-con-referencia-concurrente", errorBorrado, {
      categoriaId: id,
    });
    return desactivarCategoriaReferenciada(id, 1, false);
  }

  registrarErrorSupabaseCategorias("borrar", errorBorrado, { categoriaId: id });
  const migracionRequerida = esErrorTablaCategoriasAusente(errorBorrado);
  if (migracionRequerida) disponibilidadCategoriasNormalizadas = false;
  return { ok: false, mensaje: "No se pudo retirar la categoría.", migracionRequerida };
}

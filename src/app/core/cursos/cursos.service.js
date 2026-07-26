/*
  Servicio principal de listado y CRUD de public.cursos. El retiro seguro de una
  categoría cuenta sus referencias desde categorias.service.js.
  Depende de supabaseClient (core/supabase/supabase-client.js) y debe cargarse
  después de él. La seguridad real la impone la RLS de Postgres (insert/update/
  delete solo para rol 'admin'); estas validaciones son de UX y defensa en capa.
*/

// Acepta solo URLs http/https; rechaza javascript:, data:, etc.
function esUrlSegura(url) {
  try {
    const protocolo = new URL(url).protocol;
    return protocolo === "http:" || protocolo === "https:";
  } catch {
    return false;
  }
}

const CAMPOS_CURSO_BASE =
  "id, titulo, descripcion, imagen_url, categoria, modalidad, fecha_inicio, fecha_fin, dias_semana, hora_inicio, duracion_horas, cupo_maximo, costo, instructor, proximamente, creado_en";
const CAMPOS_CURSO_NORMALIZADO = `${CAMPOS_CURSO_BASE}, categoria_id, categoria_rel:categorias!cursos_categoria_id_fkey(id, nombre, activo)`;
let disponibilidadCategoriasEnCursos = null;

function registrarErrorSupabaseCursos(contexto, error, datos = {}) {
  console.error("[cursos.service]", {
    contexto,
    ...datos,
    error: {
      code: error?.code || null,
      message: error?.message || null,
      details: error?.details || null,
      hint: error?.hint || null,
    },
  });
}

// Solo reconoce objetos ausentes de 0010. Los demás errores conservan su flujo normal.
function esErrorEsquemaCategoriasCursoAusente(error) {
  const code = error?.code;
  const texto = `${error?.message || ""} ${error?.details || ""} ${
    error?.hint || ""
  }`.toLowerCase();
  const mencionaColumna = texto.includes("categoria_id");
  const mencionaRelacion =
    texto.includes("cursos_categoria_id_fkey") ||
    (texto.includes("cursos") && texto.includes("categorias"));
  const mencionaTabla =
    texto.includes("public.categorias") || texto.includes('relation "categorias"');

  return (
    (code === "42703" && mencionaColumna) ||
    (code === "PGRST204" && mencionaColumna) ||
    (code === "PGRST200" && mencionaRelacion) ||
    (code === "42P01" && mencionaTabla) ||
    (code === "PGRST205" && mencionaTabla)
  );
}

// Lista todos los cursos, del más reciente al más antiguo.
async function listarCursos() {
  const resultadoNormalizado = await supabaseClient
    .from("cursos")
    .select(CAMPOS_CURSO_NORMALIZADO)
    .order("creado_en", { ascending: false });

  if (!resultadoNormalizado.error) {
    disponibilidadCategoriasEnCursos = true;
    return {
      ok: true,
      data: (resultadoNormalizado.data || []).map(normalizarCategoriaCurso),
      modoCategorias: "normalizado",
    };
  }

  registrarErrorSupabaseCursos("listar-normalizado", resultadoNormalizado.error);
  if (!esErrorEsquemaCategoriasCursoAusente(resultadoNormalizado.error)) {
    return { ok: false, mensaje: "No se pudieron cargar los cursos." };
  }

  disponibilidadCategoriasEnCursos = false;
  const resultadoLegacy = await supabaseClient
    .from("cursos")
    .select(CAMPOS_CURSO_BASE)
    .order("creado_en", { ascending: false });
  if (resultadoLegacy.error) {
    registrarErrorSupabaseCursos("listar-legacy", resultadoLegacy.error);
    return { ok: false, mensaje: "No se pudieron cargar los cursos." };
  }
  return {
    ok: true,
    data: (resultadoLegacy.data || []).map(normalizarCategoriaCursoLegacy),
    modoCategorias: "legacy",
  };
}

function normalizarCategoriaCurso(curso) {
  const relacion = Array.isArray(curso.categoria_rel)
    ? curso.categoria_rel[0]
    : curso.categoria_rel;
  return {
    ...curso,
    categoria: (relacion && relacion.nombre) || curso.categoria || null,
    categoria_rel: relacion || null,
  };
}

function normalizarCategoriaCursoLegacy(curso) {
  return {
    ...curso,
    categoria: curso.categoria || null,
    categoria_id: null,
    categoria_rel: null,
  };
}

function usarCategoriasNormalizadas(campos) {
  if (disponibilidadCategoriasEnCursos === false || campos.categoria_modo === "legacy") {
    return false;
  }
  if (disponibilidadCategoriasEnCursos === true || campos.categoria_modo === "normalizado") {
    return true;
  }
  if (
    typeof obtenerDisponibilidadCategoriasNormalizadas === "function" &&
    obtenerDisponibilidadCategoriasNormalizadas() !== null
  ) {
    return obtenerDisponibilidadCategoriasNormalizadas();
  }
  return Object.hasOwn(campos, "categoria_id");
}

// Crea un curso (solo admins; la RLS bloquea a los demás).
async function crearCurso(campos) {
  const { titulo, imagen_url } = campos;
  if (!titulo) {
    return { ok: false, mensaje: "El título es obligatorio." };
  }
  if (imagen_url && !esUrlSegura(imagen_url)) {
    return { ok: false, mensaje: "La imagen debe ser una URL http o https válida." };
  }
  let usarNormalizado = usarCategoriasNormalizadas(campos);
  let resultado = await supabaseClient
    .from("cursos")
    .insert(normalizarCamposCurso(campos, usarNormalizado))
    .select()
    .single();

  if (
    resultado.error &&
    usarNormalizado &&
    esErrorEsquemaCategoriasCursoAusente(resultado.error) &&
    Object.hasOwn(campos, "categoria")
  ) {
    registrarErrorSupabaseCursos("crear-normalizado-reintento-legacy", resultado.error);
    disponibilidadCategoriasEnCursos = false;
    usarNormalizado = false;
    resultado = await supabaseClient
      .from("cursos")
      .insert(normalizarCamposCurso(campos, usarNormalizado))
      .select()
      .single();
  }

  if (resultado.error) {
    registrarErrorSupabaseCursos("crear", resultado.error, {
      modoCategorias: usarNormalizado ? "normalizado" : "legacy",
    });
    return { ok: false, mensaje: "No se pudo crear el curso." };
  }
  return { ok: true, data: resultado.data };
}

// Convierte strings vacíos del form en null y normaliza los campos numéricos/array,
// igual que ya se hacía a mano con `imagen_url || null`.
function normalizarCamposCurso(campos, usarCategoriaNormalizada = usarCategoriasNormalizadas(campos)) {
  const {
    titulo,
    descripcion,
    imagen_url,
    modalidad,
    fecha_inicio,
    fecha_fin,
    dias_semana,
    hora_inicio,
    duracion_horas,
    cupo_maximo,
    costo,
    instructor,
    proximamente,
  } = campos;
  const esProximamente = Boolean(proximamente);

  const normalizados = {
    titulo,
    descripcion: descripcion || null,
    imagen_url: imagen_url || null,
    modalidad: modalidad || null,
    fecha_inicio: esProximamente ? null : fecha_inicio || null,
    fecha_fin: esProximamente ? null : fecha_fin || null,
    dias_semana:
      esProximamente || !dias_semana || !dias_semana.length ? null : dias_semana,
    hora_inicio: esProximamente ? null : hora_inicio || null,
    duracion_horas: esProximamente || !duracion_horas ? null : parseFloat(duracion_horas),
    cupo_maximo: cupo_maximo ? parseInt(cupo_maximo, 10) : null,
    costo: costo !== "" && costo !== null && costo !== undefined ? parseFloat(costo) : null,
    instructor: instructor || null,
    proximamente: esProximamente,
  };

  if (usarCategoriaNormalizada && Object.hasOwn(campos, "categoria_id")) {
    normalizados.categoria_id = campos.categoria_id || null;
  } else if (!usarCategoriaNormalizada && Object.hasOwn(campos, "categoria")) {
    normalizados.categoria = campos.categoria || null;
  }
  return normalizados;
}

// Actualiza un curso existente (solo admins).
async function actualizarCurso(id, campos) {
  if (campos.imagen_url && !esUrlSegura(campos.imagen_url)) {
    return { ok: false, mensaje: "La imagen debe ser una URL http o https válida." };
  }
  let usarNormalizado = usarCategoriasNormalizadas(campos);
  let resultado = await supabaseClient
    .from("cursos")
    .update(normalizarCamposCurso(campos, usarNormalizado))
    .eq("id", id)
    .select()
    .single();

  if (
    resultado.error &&
    usarNormalizado &&
    esErrorEsquemaCategoriasCursoAusente(resultado.error) &&
    Object.hasOwn(campos, "categoria")
  ) {
    registrarErrorSupabaseCursos("actualizar-normalizado-reintento-legacy", resultado.error, {
      cursoId: id,
    });
    disponibilidadCategoriasEnCursos = false;
    usarNormalizado = false;
    resultado = await supabaseClient
      .from("cursos")
      .update(normalizarCamposCurso(campos, usarNormalizado))
      .eq("id", id)
      .select()
      .single();
  }

  if (resultado.error) {
    registrarErrorSupabaseCursos("actualizar", resultado.error, {
      cursoId: id,
      modoCategorias: usarNormalizado ? "normalizado" : "legacy",
    });
    return { ok: false, mensaje: "No se pudo actualizar el curso." };
  }
  return { ok: true, data: resultado.data };
}

// Elimina un curso (solo admins).
async function eliminarCurso(id) {
  const { error } = await supabaseClient.from("cursos").delete().eq("id", id);
  if (error) {
    registrarErrorSupabaseCursos("eliminar", error, { cursoId: id });
    return { ok: false, mensaje: "No se pudo eliminar el curso." };
  }
  return { ok: true };
}

// Etiqueta de modalidad para el badge de la tarjeta. null si no se capturó.
function etiquetaModalidad(curso) {
  if (curso.modalidad === "presencial") return "Presencial";
  if (curso.modalidad === "en_linea") return "En línea";
  return null;
}

// Parseo manual por partes: new Date("YYYY-MM-DD") interpreta UTC y puede mostrar
// el día anterior según la zona horaria del navegador.
function parsearFechaLocal(fecha) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

// "1 mar – 30 abr". null si no hay al menos una fecha.
function formatearRangoFechas(curso) {
  const opciones = { day: "numeric", month: "short" };
  if (curso.fecha_inicio && curso.fecha_fin) {
    const inicio = parsearFechaLocal(curso.fecha_inicio).toLocaleDateString("es-MX", opciones);
    const fin = parsearFechaLocal(curso.fecha_fin).toLocaleDateString("es-MX", opciones);
    return `${inicio} – ${fin}`;
  }
  if (curso.fecha_inicio) {
    return parsearFechaLocal(curso.fecha_inicio).toLocaleDateString("es-MX", opciones);
  }
  return null;
}

// Rango en formato de 24 horas, calculado con la hora inicial y la duración.
// La duración se captura en el formulario, pero no se muestra en las tarjetas.
function formatearHorario(curso) {
  if (typeof curso.hora_inicio !== "string") return null;

  const partesHora = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(
    curso.hora_inicio
  );
  if (!partesHora) return null;

  const horaInicio = Number(partesHora[1]);
  const minutoInicio = Number(partesHora[2]);

  const formatearMinutos = (minutosTotales) => {
    const minutosDelDia = ((minutosTotales % 1440) + 1440) % 1440;
    const hora = Math.floor(minutosDelDia / 60);
    const minuto = minutosDelDia % 60;
    return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
  };

  const inicioEnMinutos = horaInicio * 60 + minutoInicio;
  const duracionEnMinutos = Math.round(Number(curso.duracion_horas) * 60);
  const inicio = formatearMinutos(inicioEnMinutos);

  if (!Number.isFinite(duracionEnMinutos) || duracionEnMinutos <= 0) return inicio;

  return `${inicio} - ${formatearMinutos(inicioEnMinutos + duracionEnMinutos)}`;
}

// "Gratis" si el costo es 0, "$500.00 MXN" si es mayor, null si no se capturó.
function formatearCosto(costo) {
  if (costo === null || costo === undefined) return null;
  if (Number(costo) === 0) return "Gratis";
  return `$${Number(costo).toFixed(2)} MXN`;
}

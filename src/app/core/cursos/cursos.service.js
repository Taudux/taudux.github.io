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

function iniciarMedicionOperacion() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function duracionOperacion(inicio) {
  const fin = typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
  return Math.max(0, Math.round((fin - inicio) * 100) / 100);
}

function valorTelemetriaSeguro(valor, predeterminado) {
  const texto = typeof valor === "string" ? valor : "";
  return /^[a-zA-Z0-9:_-]{1,64}$/.test(texto) ? texto : predeterminado;
}

// Contrato local y sanitizado para que un listener de producción pueda recolectar
// errores sin recibir títulos, IDs, nombres, payloads ni mensajes de Supabase.
function reportarErrorOperacion({ operacion, pagina, error = null, codigo = null, inicio }) {
  const detalle = Object.freeze({
    operation: valorTelemetriaSeguro(operacion, "unknown_operation"),
    page: valorTelemetriaSeguro(pagina, "unknown_page"),
    code: valorTelemetriaSeguro(codigo || error?.code, "unknown_error"),
    durationMs: duracionOperacion(inicio),
  });
  console.error("[taudux:operation-error]", detalle);
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function" &&
    typeof CustomEvent === "function"
  ) {
    window.dispatchEvent(new CustomEvent("taudux:operation-error", { detail: detalle }));
  }
  return detalle;
}

function registrarErrorSupabaseCursos(contexto, error, datos = {}) {
  console.error("[cursos.service]", {
    contexto,
    ...datos,
    error: {
      code: error?.code || null,
      type: error?.name || null,
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
    return {
      ok: false,
      codigo: resultadoNormalizado.error.code || "list_failed",
      mensaje: "No se pudieron cargar los cursos.",
    };
  }

  disponibilidadCategoriasEnCursos = false;
  const resultadoLegacy = await supabaseClient
    .from("cursos")
    .select(CAMPOS_CURSO_BASE)
    .order("creado_en", { ascending: false });
  if (resultadoLegacy.error) {
    registrarErrorSupabaseCursos("listar-legacy", resultadoLegacy.error);
    return {
      ok: false,
      codigo: resultadoLegacy.error.code || "legacy_list_failed",
      mensaje: "No se pudieron cargar los cursos.",
    };
  }
  return {
    ok: true,
    data: (resultadoLegacy.data || []).map(normalizarCategoriaCursoLegacy),
    modoCategorias: "legacy",
  };
}

// Obtiene exactamente un curso para la pantalla de edición. `data: null` indica
// que el ID no existe; solo retrocede al SELECT legado si falta el esquema de 0010.
async function obtenerCursoPorId(id) {
  const resultadoNormalizado = await supabaseClient
    .from("cursos")
    .select(CAMPOS_CURSO_NORMALIZADO)
    .eq("id", id)
    .maybeSingle();

  if (!resultadoNormalizado.error) {
    disponibilidadCategoriasEnCursos = true;
    return {
      ok: true,
      data: resultadoNormalizado.data
        ? normalizarCategoriaCurso(resultadoNormalizado.data)
        : null,
      modoCategorias: "normalizado",
    };
  }

  registrarErrorSupabaseCursos("obtener-por-id-normalizado", resultadoNormalizado.error, {
    consulta: "exacta",
  });
  if (!esErrorEsquemaCategoriasCursoAusente(resultadoNormalizado.error)) {
    return {
      ok: false,
      codigo: resultadoNormalizado.error.code || "course_load_failed",
      mensaje: "No se pudo cargar el curso.",
    };
  }

  disponibilidadCategoriasEnCursos = false;
  const resultadoLegacy = await supabaseClient
    .from("cursos")
    .select(CAMPOS_CURSO_BASE)
    .eq("id", id)
    .maybeSingle();
  if (resultadoLegacy.error) {
    registrarErrorSupabaseCursos("obtener-por-id-legacy", resultadoLegacy.error, {
      consulta: "exacta-legacy",
    });
    return {
      ok: false,
      codigo: resultadoLegacy.error.code || "legacy_course_load_failed",
      mensaje: "No se pudo cargar el curso.",
    };
  }
  return {
    ok: true,
    data: resultadoLegacy.data
      ? normalizarCategoriaCursoLegacy(resultadoLegacy.data)
      : null,
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

function esUuidOperacionValido(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function esErrorInsercionAmbigua(error) {
  if (!error) return false;
  if (error.code) return ["FETCH_ERROR", "NETWORK_ERROR", "TIMEOUT"].includes(error.code);
  const texto = `${error.message || ""} ${error.name || ""}`.toLowerCase();
  return /failed to fetch|network|timeout|timed out|abort|load failed/.test(texto);
}

function canonicalizarHoraComparable(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== "string") return undefined;
  const partes = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d+))?)?$/.exec(valor);
  if (!partes) return undefined;
  const fraccion = (partes[4] || "").replace(/0+$/, "");
  return `${partes[1]}:${partes[2]}:${partes[3] || "00"}${fraccion ? `.${fraccion}` : ""}`;
}

function valorCursoComparable(campo, valor) {
  if (["duracion_horas", "cupo_maximo", "costo"].includes(campo)) {
    return valor === null || valor === undefined ? null : Number(valor);
  }
  if (campo === "dias_semana") return JSON.stringify(valor || null);
  if (campo === "hora_inicio") return canonicalizarHoraComparable(valor);
  return valor === undefined ? null : valor;
}

function cursoCoincideConOperacion(curso, camposEsperados, usarNormalizado) {
  const campos = [
    "titulo",
    "descripcion",
    "imagen_url",
    "modalidad",
    "fecha_inicio",
    "fecha_fin",
    "dias_semana",
    "hora_inicio",
    "duracion_horas",
    "cupo_maximo",
    "costo",
    "instructor",
    "proximamente",
  ];
  const mismosCampos = campos.every((campo) => {
    const valorActual = valorCursoComparable(campo, curso[campo]);
    const valorEsperado = valorCursoComparable(campo, camposEsperados[campo]);
    return (
      (campo !== "hora_inicio" ||
        (valorActual !== undefined && valorEsperado !== undefined)) &&
      valorActual === valorEsperado
    );
  });
  if (!mismosCampos) return false;
  return usarNormalizado
    ? (curso.categoria_id || null) === (camposEsperados.categoria_id || null)
    : (curso.categoria || null) === (camposEsperados.categoria || null);
}

async function reconciliarCreacionCurso(id, camposEsperados, usarNormalizado) {
  const resultado = await obtenerCursoPorId(id);
  if (!resultado.ok || !resultado.data) return { confirmada: false, disponible: resultado.ok };
  return {
    confirmada: cursoCoincideConOperacion(resultado.data, camposEsperados, usarNormalizado),
    disponible: true,
    data: resultado.data,
  };
}

async function insertarCursoConReconciliacion(id, campos, usarNormalizado) {
  const camposNormalizados = normalizarCamposCurso(campos, usarNormalizado);
  const resultado = await supabaseClient
    .from("cursos")
    .insert({ id, ...camposNormalizados })
    .select()
    .single();

  if (!resultado.error) return { ok: true, data: resultado.data };

  const duplicada = resultado.error.code === "23505";
  const ambigua = esErrorInsercionAmbigua(resultado.error);
  if (duplicada || ambigua) {
    let reconciliacion;
    try {
      reconciliacion = await reconciliarCreacionCurso(id, camposNormalizados, usarNormalizado);
    } catch {
      return {
        ok: false,
        ambigua: true,
        codigo: "create_confirmation_pending",
        mensaje: "No se pudo confirmar si el curso fue publicado. Reintenta sin cambiar los datos.",
      };
    }
    if (reconciliacion.confirmada) {
      return { ok: true, data: reconciliacion.data, reconciliada: true };
    }
    if (duplicada && reconciliacion.disponible) {
      return {
        ok: false,
        codigo: "operation_id_conflict",
        mensaje: "No se pudo confirmar la creación del curso. Recarga la página e inténtalo de nuevo.",
      };
    }
    return {
      ok: false,
      ambigua: true,
      codigo: "create_confirmation_pending",
      mensaje: "No se pudo confirmar si el curso fue publicado. Reintenta sin cambiar los datos.",
    };
  }
  return { ok: false, error: resultado.error };
}

// Crea un curso con un UUID de operación estable (solo admins; RLS es autoritativa).
async function crearCurso(campos, operacionId) {
  const { titulo, imagen_url } = campos;
  if (!titulo) {
    return { ok: false, codigo: "title_required", mensaje: "El título es obligatorio." };
  }
  if (imagen_url && !esUrlSegura(imagen_url)) {
    return {
      ok: false,
      codigo: "invalid_image_url",
      mensaje: "La imagen debe ser una URL http o https válida.",
    };
  }
  if (!esUuidOperacionValido(operacionId)) {
    return {
      ok: false,
      codigo: "operation_id_unavailable",
      mensaje: "No se pudo preparar una publicación segura. Actualiza tu navegador e inténtalo de nuevo.",
    };
  }
  let usarNormalizado = usarCategoriasNormalizadas(campos);
  let resultado = await insertarCursoConReconciliacion(operacionId, campos, usarNormalizado);

  if (
    !resultado.ok &&
    resultado.error &&
    usarNormalizado &&
    esErrorEsquemaCategoriasCursoAusente(resultado.error) &&
    Object.hasOwn(campos, "categoria")
  ) {
    registrarErrorSupabaseCursos("crear-normalizado-reintento-legacy", resultado.error);
    disponibilidadCategoriasEnCursos = false;
    usarNormalizado = false;
    resultado = await insertarCursoConReconciliacion(operacionId, campos, usarNormalizado);
  }

  if (!resultado.ok) {
    if (resultado.error) registrarErrorSupabaseCursos("crear", resultado.error, {
      modoCategorias: usarNormalizado ? "normalizado" : "legacy",
    });
    return {
      ...resultado,
      mensaje: resultado.mensaje || "No se pudo crear el curso.",
      codigo: resultado.codigo || resultado.error?.code || "create_failed",
    };
  }
  return resultado;
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
      modoCategorias: "normalizado",
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
      modoCategorias: usarNormalizado ? "normalizado" : "legacy",
    });
    return {
      ok: false,
      codigo: resultado.error.code || "update_failed",
      mensaje: "No se pudo actualizar el curso.",
    };
  }
  return { ok: true, data: resultado.data };
}

// Elimina un curso (solo admins).
async function eliminarCurso(id) {
  const { error } = await supabaseClient.from("cursos").delete().eq("id", id);
  if (error) {
    registrarErrorSupabaseCursos("eliminar", error);
    return {
      ok: false,
      codigo: error.code || "delete_failed",
      mensaje: "No se pudo eliminar el curso.",
    };
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

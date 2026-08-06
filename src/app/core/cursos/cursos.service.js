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
  "id, titulo, descripcion, imagen_url, imagen_storage_path, categoria, modalidad, fecha_inicio, fecha_fin, dias_semana, hora_inicio, duracion_horas, cupo_maximo, costo, instructor, proximamente, estado, creado_en, temario, dirigido_a, requisitos, herramientas, numero_sesiones";
const CAMPOS_CURSO_NORMALIZADO = `${CAMPOS_CURSO_BASE}, categoria_id, categoria_rel:categorias!cursos_categoria_id_fkey(id, nombre, activo)`;
let disponibilidadCategoriasEnCursos = null;

// Borrador y archivado quedan fuera del catálogo público (RLS de 0014); esta
// lista solo es defensa en capa, la autoridad real es el check constraint.
const ESTADOS_CURSO_VALIDOS = new Set(["borrador", "publicado", "archivado"]);
function estadoCursoValido(estado) {
  return ESTADOS_CURSO_VALIDOS.has(estado);
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

/*
  Toda lectura de cursos sigue la misma máquina: intenta el SELECT normalizado y,
  solo si el error es la ausencia del esquema de 0010, retrocede al SELECT
  legado. Cualquier otro error se propaga tal cual. `consultar` recibe la lista
  de campos y devuelve la promesa de Supabase; `adaptar` traduce cada fila.
*/
async function leerCursosConFallbackCategorias({
  consultar,
  adaptar,
  contexto,
  mensajeError,
  codigoNormalizado,
  codigoLegacy,
  datosRegistro = {},
}) {
  const normalizado = await consultar(CAMPOS_CURSO_NORMALIZADO);
  if (!normalizado.error) {
    disponibilidadCategoriasEnCursos = true;
    return { ok: true, data: adaptar(normalizado.data, normalizarCategoriaCurso), modoCategorias: "normalizado" };
  }

  registrarErrorSupabaseCursos(`${contexto}-normalizado`, normalizado.error, datosRegistro);
  if (!esErrorEsquemaCategoriasCursoAusente(normalizado.error)) {
    return { ok: false, codigo: normalizado.error.code || codigoNormalizado, mensaje: mensajeError };
  }

  disponibilidadCategoriasEnCursos = false;
  const legacy = await consultar(CAMPOS_CURSO_BASE);
  if (legacy.error) {
    registrarErrorSupabaseCursos(`${contexto}-legacy`, legacy.error, datosRegistro);
    return { ok: false, codigo: legacy.error.code || codigoLegacy, mensaje: mensajeError };
  }
  return { ok: true, data: adaptar(legacy.data, normalizarCategoriaCursoLegacy), modoCategorias: "legacy" };
}

const adaptarLista = (data, normalizar) => (data || []).map(normalizar);
const adaptarFila = (data, normalizar) => (data ? normalizar(data) : null);

// Lista todos los cursos, del más reciente al más antiguo.
function listarCursos() {
  return leerCursosConFallbackCategorias({
    consultar: (campos) => supabaseClient
      .from("cursos")
      .select(campos)
      .order("creado_en", { ascending: false }),
    adaptar: adaptarLista,
    contexto: "listar",
    mensajeError: "No se pudieron cargar los cursos.",
    codigoNormalizado: "list_failed",
    codigoLegacy: "legacy_list_failed",
  });
}

// Obtiene exactamente un curso para la pantalla de edición. `data: null` indica
// que el ID no existe; solo retrocede al SELECT legado si falta el esquema de 0010.
function obtenerCursoPorId(id) {
  return leerCursosConFallbackCategorias({
    consultar: (campos) => supabaseClient
      .from("cursos")
      .select(campos)
      .eq("id", id)
      .maybeSingle(),
    adaptar: adaptarFila,
    contexto: "obtener-por-id",
    mensajeError: "No se pudo cargar el curso.",
    codigoNormalizado: "course_load_failed",
    codigoLegacy: "legacy_course_load_failed",
    datosRegistro: { consulta: "exacta" },
  });
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
  return UUID_OPERACION_CURSO.test(id);
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
  // El temario es un arreglo anidado: comparado por identidad nunca coincidiría
  // consigo mismo tras el viaje a Postgres, igual que dias_semana.
  if (campo === "temario") return JSON.stringify(valor || null);
  if (campo === "hora_inicio") return canonicalizarHoraComparable(valor);
  return valor === undefined ? null : valor;
}

const CAMPOS_RECONCILIABLES = Object.freeze([
  "titulo",
  "descripcion",
  "imagen_url",
  "imagen_storage_path",
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
  "estado",
  "temario",
  "dirigido_a",
  "requisitos",
  "herramientas",
  "numero_sesiones",
]);

/*
  `undefined` significa "hora que no supe canonicalizar", no "hora ausente": dos
  valores incomparables nunca deben leerse como iguales, así que ese campo exige
  ambos lados canonicalizados antes de comparar.
*/
function campoCursoCoincide(campo, curso, camposEsperados) {
  const valorActual = valorCursoComparable(campo, curso[campo]);
  const valorEsperado = valorCursoComparable(campo, camposEsperados[campo]);
  if (campo === "hora_inicio" && (valorActual === undefined || valorEsperado === undefined)) {
    return false;
  }
  return valorActual === valorEsperado;
}

function categoriaCursoCoincide(curso, camposEsperados, usarNormalizado) {
  const campo = usarNormalizado ? "categoria_id" : "categoria";
  return (curso[campo] || null) === (camposEsperados[campo] || null);
}

function cursoCoincideConOperacion(curso, camposEsperados, usarNormalizado) {
  const mismosCampos = CAMPOS_RECONCILIABLES
    .every((campo) => campoCursoCoincide(campo, curso, camposEsperados));
  return mismosCampos && categoriaCursoCoincide(curso, camposEsperados, usarNormalizado);
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

/*
  Defensa en capa sobre la portada, idéntica al crear y al actualizar: la URL
  debe ser navegable, una portada gestionada debe apuntar exactamente a su ruta
  de Storage, y el token de asociación solo vale acompañado de esa ruta.
  Devuelve null cuando no hay objeción.
*/
function validarPortadaEnCampos({ imagen_url, imagen_storage_path, imagen_upload_token }) {
  if (imagen_url && !esUrlSegura(imagen_url)) {
    return {
      ok: false,
      codigo: "invalid_image_url",
      mensaje: "La imagen debe ser una URL http o https válida.",
    };
  }
  if (imagen_storage_path && imagen_url !== urlPublicaPortada(imagen_storage_path)) {
    return {
      ok: false,
      codigo: "invalid_managed_cover",
      mensaje: "La portada administrada no es válida.",
    };
  }
  const tokenSinRuta = !imagen_storage_path || !UUID_TOKEN_PORTADA.test(imagen_upload_token);
  if (imagen_upload_token && tokenSinRuta) {
    return {
      ok: false,
      codigo: "invalid_cover_intent",
      mensaje: "No se pudo asociar la portada de forma segura. Vuelve a subirla.",
    };
  }
  return null;
}

// Crea un curso con un UUID de operación estable (solo admins; RLS es autoritativa).
async function crearCurso(campos, operacionId) {
  if (!campos.titulo) {
    return { ok: false, codigo: "title_required", mensaje: "El título es obligatorio." };
  }
  if (Object.hasOwn(campos, "estado") && !estadoCursoValido(campos.estado)) {
    return { ok: false, codigo: "invalid_estado", mensaje: "Estado de curso inválido." };
  }
  const portadaInvalida = validarPortadaEnCampos(campos);
  if (portadaInvalida) return portadaInvalida;
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

function esValorCapturado(valor) {
  return valor !== "" && valor !== null && valor !== undefined;
}

// Convierte strings vacíos del form en null y normaliza los campos numéricos/array,
// igual que ya se hacía a mano con `imagen_url || null`.
function normalizarCamposCurso(campos, usarCategoriaNormalizada = usarCategoriasNormalizadas(campos)) {
  const {
    titulo,
    descripcion,
    imagen_url,
    imagen_storage_path,
    imagen_upload_token,
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
    temario,
    dirigido_a,
    requisitos,
    herramientas,
    numero_sesiones,
  } = campos;
  const esProximamente = Boolean(proximamente);

  const normalizados = {
    titulo,
    descripcion: descripcion || null,
    imagen_url: imagen_url || null,
    imagen_storage_path: imagen_storage_path || null,
    modalidad: modalidad || null,
    fecha_inicio: esProximamente ? null : fecha_inicio || null,
    fecha_fin: esProximamente ? null : fecha_fin || null,
    dias_semana:
      esProximamente || !dias_semana || !dias_semana.length ? null : dias_semana,
    hora_inicio: esProximamente ? null : hora_inicio || null,
    duracion_horas: esProximamente || !duracion_horas ? null : parseFloat(duracion_horas),
    cupo_maximo: cupo_maximo ? parseInt(cupo_maximo, 10) : null,
    // El costo 0 es significativo ("Gratis"), así que solo el vacío es null.
    costo: esValorCapturado(costo) ? parseFloat(costo) : null,
    instructor: instructor || null,
    proximamente: esProximamente,
    // Un temario vacío se guarda como null, no como [], igual que dias_semana:
    // así "sin temario" tiene una sola representación en la base.
    temario: Array.isArray(temario) && temario.length ? temario : null,
    dirigido_a: dirigido_a || null,
    requisitos: requisitos || null,
    herramientas: herramientas || null,
    numero_sesiones: numero_sesiones ? parseInt(numero_sesiones, 10) : null,
  };

  if (imagen_upload_token) normalizados.imagen_upload_token = imagen_upload_token;

  if (usarCategoriaNormalizada && Object.hasOwn(campos, "categoria_id")) {
    normalizados.categoria_id = campos.categoria_id || null;
  } else if (!usarCategoriaNormalizada && Object.hasOwn(campos, "categoria")) {
    normalizados.categoria = campos.categoria || null;
  }
  if (Object.hasOwn(campos, "estado")) normalizados.estado = campos.estado;
  return normalizados;
}

// Filtra por el valor esperado, distinguiendo "es null" de "es igual a".
function filtrarPorValorEsperado(solicitud, columna, esperado) {
  return esperado === null ? solicitud.is(columna, null) : solicitud.eq(columna, esperado);
}

/*
  UPDATE optimista: solo modifica la fila si la portada sigue siendo exactamente
  la que el formulario cargó. Si el par no coincide, Postgres no toca nada y
  Supabase devuelve data null, que traducimos a cover_conflict.
*/
function construirActualizacionCurso(id, campos, portadaEsperada, usarNormalizado) {
  const solicitud = supabaseClient
    .from("cursos")
    .update(normalizarCamposCurso(campos, usarNormalizado))
    .eq("id", id);
  const conUrl = filtrarPorValorEsperado(solicitud, "imagen_url", portadaEsperada.url);
  const conPar = filtrarPorValorEsperado(conUrl, "imagen_storage_path", portadaEsperada.path);
  return conPar.select().maybeSingle();
}

function esPortadaEsperadaCompleta(portadaEsperada) {
  return Boolean(portadaEsperada) &&
    Object.hasOwn(portadaEsperada, "url") &&
    Object.hasOwn(portadaEsperada, "path");
}

// Actualiza un curso existente (solo admins).
async function actualizarCurso(id, campos, portadaEsperada) {
  if (Object.hasOwn(campos, "estado") && !estadoCursoValido(campos.estado)) {
    return { ok: false, codigo: "invalid_estado", mensaje: "Estado de curso inválido." };
  }
  const portadaInvalida = validarPortadaEnCampos(campos);
  if (portadaInvalida) return portadaInvalida;
  if (!esPortadaEsperadaCompleta(portadaEsperada)) {
    return { ok: false, codigo: "cover_conflict", mensaje: "La portada cambió. Recarga la página." };
  }

  let usarNormalizado = usarCategoriasNormalizadas(campos);
  let resultado = await construirActualizacionCurso(id, campos, portadaEsperada, usarNormalizado);

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
    resultado = await construirActualizacionCurso(id, campos, portadaEsperada, usarNormalizado);
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
  if (!resultado.data) {
    return {
      ok: false,
      codigo: "cover_conflict",
      mensaje: "La portada cambió en otra sesión. Recarga la página antes de guardar.",
    };
  }
  return { ok: true, data: resultado.data };
}

/*
  Elimina un curso (solo admins). El delete pide las filas afectadas con select():
  sin él, un delete que la RLS filtra en silencio devolvía ok con cero filas
  borradas. Cuando no vuelve ninguna fila, sondeamos su existencia para separar
  "no tienes permiso" de un borrado idempotente; la policy cursos_select_autenticados
  deja leer a cualquier autenticado, así que la sonda sí discrimina.

  La portada no se toca desde acá: el trigger cursos_enqueue_cover_cleanup la encola
  al borrar la fila, y storage.objects no acepta mutaciones desde el cliente.
*/
async function eliminarCurso(id) {
  if (typeof id !== "string" || !id.trim()) {
    return {
      ok: false,
      codigo: "invalid_course_id",
      mensaje: "No se pudo identificar el curso. Recarga la página e inténtalo de nuevo.",
    };
  }

  const { data, error } = await supabaseClient
    .from("cursos")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    registrarErrorSupabaseCursos("eliminar", error);
    return {
      ok: false,
      codigo: error.code || "delete_failed",
      mensaje: "No se pudo eliminar el curso.",
    };
  }
  if (data && data.length > 0) return { ok: true, id };

  const verificacion = await supabaseClient
    .from("cursos")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (verificacion.error) {
    registrarErrorSupabaseCursos("eliminar-verificar", verificacion.error);
    return {
      ok: false,
      codigo: "delete_unverified",
      mensaje: "No se pudo confirmar la eliminación. Recarga la página para ver el estado real.",
    };
  }
  if (verificacion.data) {
    return {
      ok: false,
      codigo: "forbidden",
      mensaje: "No tienes permisos para eliminar cursos.",
    };
  }
  return { ok: true, id, yaNoExistia: true };
}

/*
  Cambia solo el estado editorial de un curso (archivar/publicar desde
  administrar-cursos): un UPDATE dirigido, sin pasar por el resto del formulario
  ni por el bloqueo optimista de portada que usa actualizarCurso. select()
  pide la fila para distinguir "RLS bloqueó el update" (0 admins) de un éxito
  real, igual que eliminarCurso.
*/
async function actualizarEstadoCurso(id, estado) {
  if (typeof id !== "string" || !id.trim()) {
    return {
      ok: false,
      codigo: "invalid_course_id",
      mensaje: "No se pudo identificar el curso. Recarga la página e inténtalo de nuevo.",
    };
  }
  if (!estadoCursoValido(estado)) {
    return { ok: false, codigo: "invalid_estado", mensaje: "Estado de curso inválido." };
  }

  const { data, error } = await supabaseClient
    .from("cursos")
    .update({ estado })
    .eq("id", id)
    .select("id, estado")
    .maybeSingle();

  if (error) {
    registrarErrorSupabaseCursos("actualizar-estado", error);
    return {
      ok: false,
      codigo: error.code || "update_estado_failed",
      mensaje: "No se pudo actualizar el estado del curso.",
    };
  }
  if (!data) {
    return {
      ok: false,
      codigo: "forbidden",
      mensaje: "No tienes permisos para modificar este curso, o ya no existe.",
    };
  }
  return { ok: true, data };
}

/*
  Consulta si un curso ya envió su aviso de publicación push (solo admins,
  vía RPC security definer de la migración 0018; el envío era por correo
  antes de la 0026). El cliente nunca lee curso_anuncios directo: la tabla
  tiene revoke all desde 0015. Primera llamada .rpc() de este servicio.
*/
async function cursoYaAnunciado(id) {
  if (typeof id !== "string" || !id.trim()) {
    return {
      ok: false,
      codigo: "invalid_course_id",
      mensaje: "No se pudo identificar el curso. Recarga la página e inténtalo de nuevo.",
    };
  }

  const { data, error } = await supabaseClient.rpc("curso_anunciado", { p_curso_id: id });

  if (error) {
    registrarErrorSupabaseCursos("curso-ya-anunciado", error);
    return {
      ok: false,
      codigo: error.code || "curso_anunciado_failed",
      mensaje: "No se pudo verificar si el curso ya fue anunciado.",
    };
  }
  return { ok: true, data: Boolean(data) };
}

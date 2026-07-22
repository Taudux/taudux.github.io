/*
  Servicio de datos de cursos: único punto de acceso a la tabla public.cursos.
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

// Lista todos los cursos, del más reciente al más antiguo.
async function listarCursos() {
  const { data, error } = await supabaseClient
    .from("cursos")
    .select(
      "id, titulo, descripcion, imagen_url, categoria, modalidad, fecha_inicio, fecha_fin, dias_semana, hora_inicio, duracion_horas, cupo_maximo, costo, instructor, proximamente, creado_en"
    )
    .order("creado_en", { ascending: false });
  if (error) return { ok: false, mensaje: "No se pudieron cargar los cursos." };
  return { ok: true, data };
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
  const { data, error } = await supabaseClient
    .from("cursos")
    .insert(normalizarCamposCurso(campos))
    .select()
    .single();
  if (error) return { ok: false, mensaje: "No se pudo crear el curso." };
  return { ok: true, data };
}

// Convierte strings vacíos del form en null y normaliza los campos numéricos/array,
// igual que ya se hacía a mano con `imagen_url || null`.
function normalizarCamposCurso({
  titulo,
  descripcion,
  imagen_url,
  categoria,
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
}) {
  return {
    titulo,
    descripcion: descripcion || null,
    imagen_url: imagen_url || null,
    categoria: categoria || null,
    modalidad: modalidad || null,
    fecha_inicio: fecha_inicio || null,
    fecha_fin: fecha_fin || null,
    dias_semana: dias_semana && dias_semana.length ? dias_semana : null,
    hora_inicio: hora_inicio || null,
    duracion_horas: duracion_horas ? parseFloat(duracion_horas) : null,
    cupo_maximo: cupo_maximo ? parseInt(cupo_maximo, 10) : null,
    costo: costo !== "" && costo !== null && costo !== undefined ? parseFloat(costo) : null,
    instructor: instructor || null,
    proximamente: Boolean(proximamente),
  };
}

// Actualiza un curso existente (solo admins).
async function actualizarCurso(id, campos) {
  if (campos.imagen_url && !esUrlSegura(campos.imagen_url)) {
    return { ok: false, mensaje: "La imagen debe ser una URL http o https válida." };
  }
  const { data, error } = await supabaseClient
    .from("cursos")
    .update(normalizarCamposCurso(campos))
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, mensaje: "No se pudo actualizar el curso." };
  return { ok: true, data };
}

// Elimina un curso (solo admins).
async function eliminarCurso(id) {
  const { error } = await supabaseClient.from("cursos").delete().eq("id", id);
  if (error) return { ok: false, mensaje: "No se pudo eliminar el curso." };
  return { ok: true };
}

// Etiqueta de modalidad para el badge de la tarjeta. null si no se capturó.
function etiquetaModalidad(curso) {
  if (curso.modalidad === "presencial") return "Presencial";
  if (curso.modalidad === "en_linea") return "En línea";
  return null;
}

// Orden y abreviaturas de los días de la semana (códigos guardados en BD).
const DIAS_SEMANA_ORDEN = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const DIAS_SEMANA_ETIQUETA = {
  lun: "Lun",
  mar: "Mar",
  mie: "Mié",
  jue: "Jue",
  vie: "Vie",
  sab: "Sáb",
  dom: "Dom",
};

// "Lun y Mié" / "Lun, Mié y Vie", ordenados de lunes a domingo. null si no hay días.
function formatearDiasSemana(dias) {
  if (!dias || dias.length === 0) return null;
  const ordenados = DIAS_SEMANA_ORDEN.filter((codigo) => dias.includes(codigo)).map(
    (codigo) => DIAS_SEMANA_ETIQUETA[codigo]
  );
  if (ordenados.length === 1) return ordenados[0];
  return `${ordenados.slice(0, -1).join(", ")} y ${ordenados[ordenados.length - 1]}`;
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

// Línea meta compacta "Lun y Mié · 6:00 pm · 2 h", omitiendo lo que falte.
// Comparte formato entre el catálogo público y el panel de gestión.
function formatearHorario(curso) {
  const partes = [];

  const dias = formatearDiasSemana(curso.dias_semana);
  if (dias) partes.push(dias);

  if (curso.hora_inicio) {
    const [hora, minuto] = curso.hora_inicio.split(":").map(Number);
    const horaLocal = new Date();
    horaLocal.setHours(hora, minuto, 0, 0);
    partes.push(
      horaLocal.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })
    );
  }

  if (curso.duracion_horas) {
    partes.push(`${curso.duracion_horas} h`);
  }

  return partes.join(" · ");
}

// "Gratis" si el costo es 0, "$500.00 MXN" si es mayor, null si no se capturó.
function formatearCosto(costo) {
  if (costo === null || costo === undefined) return null;
  if (Number(costo) === 0) return "Gratis";
  return `$${Number(costo).toFixed(2)} MXN`;
}

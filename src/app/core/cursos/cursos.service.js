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

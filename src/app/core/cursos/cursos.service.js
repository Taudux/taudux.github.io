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
    .select("id, titulo, descripcion, enlace, imagen_url, creado_en")
    .order("creado_en", { ascending: false });
  if (error) return { ok: false, mensaje: "No se pudieron cargar los cursos." };
  return { ok: true, data };
}

// Crea un curso (solo admins; la RLS bloquea a los demás).
async function crearCurso({ titulo, descripcion, enlace, imagen_url }) {
  if (!titulo || !enlace) {
    return { ok: false, mensaje: "El título y el enlace son obligatorios." };
  }
  if (!esUrlSegura(enlace)) {
    return { ok: false, mensaje: "El enlace debe ser una URL http o https válida." };
  }
  if (imagen_url && !esUrlSegura(imagen_url)) {
    return { ok: false, mensaje: "La imagen debe ser una URL http o https válida." };
  }
  const { data, error } = await supabaseClient
    .from("cursos")
    .insert({ titulo, descripcion, enlace, imagen_url: imagen_url || null })
    .select()
    .single();
  if (error) return { ok: false, mensaje: "No se pudo crear el curso." };
  return { ok: true, data };
}

// Actualiza un curso existente (solo admins).
async function actualizarCurso(id, campos) {
  if (campos.enlace && !esUrlSegura(campos.enlace)) {
    return { ok: false, mensaje: "El enlace debe ser una URL http o https válida." };
  }
  if (campos.imagen_url && !esUrlSegura(campos.imagen_url)) {
    return { ok: false, mensaje: "La imagen debe ser una URL http o https válida." };
  }
  const { data, error } = await supabaseClient
    .from("cursos")
    .update(campos)
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

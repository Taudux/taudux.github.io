/*
  Servicio de escritura del perfil propio. Depende de supabaseClient y debe
  cargarse después de él. RLS restringe el UPDATE a la fila propia y a las
  columnas nombre, apellidos, telefono, avisos_curso_nuevo (rol queda fuera).
*/

async function actualizarPerfil(userId, campos) {
  const { data, error } = await supabaseClient
    .from("perfiles")
    .update(campos)
    .eq("id", userId)
    .select("nombre, apellidos, telefono, avisos_curso_nuevo")
    .single();

  if (error) {
    console.error("[perfil.service] actualizar", error);
    return { ok: false, mensaje: "No se pudieron guardar los cambios." };
  }

  return { ok: true, data };
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({ actualizarPerfil });
}

/*
  Núcleo puro del portal de cuenta: el catálogo de secciones y la resolución de
  cuál está activa según el hash de la URL. Sin DOM y sin efectos, así que Node
  puede requerirlo en los tests igual que el borrador del formulario de curso.

  Una sección con `disponible: false` sigue siendo un destino válido: la página
  existe y explica qué falta, no se esconde. Lo que nunca vale es un hash
  desconocido — ahí se cae a la primera sección en vez de dejar el portal vacío.
*/

const SECCIONES_PORTAL = [
  { id: "perfil", etiqueta: "Editar Perfil", disponible: true },
  { id: "cuenta", etiqueta: "Mi cuenta", disponible: true },
  { id: "correo", etiqueta: "Preferencias de correo", disponible: true },
  { id: "plan", etiqueta: "Mi plan", disponible: false },
  { id: "pagos", etiqueta: "Pagos", disponible: false },
];

function normalizarHash(hash) {
  if (typeof hash !== "string") return "";
  return hash.replace(/^#/, "").trim();
}

/*
  Nunca devuelve undefined: el portal siempre tiene una sección visible. Un hash
  basura (`#<script>`) no matchea ningún id y cae en la primera sección, que es
  también el destino de una carga sin hash.
*/
function resolverSeccionActiva(hash, secciones = SECCIONES_PORTAL) {
  const disponibles = Array.isArray(secciones) && secciones.length > 0 ? secciones : SECCIONES_PORTAL;
  const candidato = normalizarHash(hash);
  const encontrada = disponibles.find((seccion) => seccion.id === candidato);
  return encontrada ? encontrada.id : disponibles[0].id;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    SECCIONES_PORTAL,
    resolverSeccionActiva,
  });
}

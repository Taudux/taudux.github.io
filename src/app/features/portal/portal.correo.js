/*
  Núcleo puro de "Preferencias de correo": normalización y diff del checkbox
  de aviso de curso nuevo. Sin DOM y sin fetch, igual que portal.perfil.js —
  Node lo puede requerir directo en los tests.

  El cableado (leer el checkbox, mostrar errores, llamar al service) vive en
  portal.js.
*/

// undefined/null (fila de la BD sin el dato, o perfil aún no cargado) se
// normalizan a false: sin preferencia guardada, no se avisa.
function normalizarPreferenciasCorreo({ avisosCursoNuevo } = {}) {
  return { avisosCursoNuevo: Boolean(avisosCursoNuevo) };
}

/*
  Devuelve ya el nombre de columna de la BD (avisos_curso_nuevo), para que el
  resultado sea paso directo al service, igual que camposModificados de
  portal.perfil.js. {} si el checkbox coincide con lo guardado.
*/
function cambiosPreferenciasCorreo(original, actual) {
  const base = normalizarPreferenciasCorreo(original);
  const nuevo = normalizarPreferenciasCorreo(actual);

  if (base.avisosCursoNuevo === nuevo.avisosCursoNuevo) return {};
  return { avisos_curso_nuevo: nuevo.avisosCursoNuevo };
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    normalizarPreferenciasCorreo,
    cambiosPreferenciasCorreo,
  });
}

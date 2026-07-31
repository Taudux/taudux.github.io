/*
  Núcleo puro del formulario "Editar Perfil": normalización, validación y el
  diff contra lo que ya está guardado. Sin DOM y sin fetch, así que Node lo
  puede requerir directo en los tests, igual que gestionar-curso.borrador.js.

  El cableado (leer inputs, mostrar errores, llamar al service) vive en
  portal.js.
*/

const LONGITUD_MAXIMA_NOMBRE_PERFIL = 120;
const PATRON_TELEFONO_PERFIL = /^\+[1-9]\d{7,14}$/;

function aTexto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

// undefined/null (típico de una fila de la BD sin ese dato) se normalizan a
// "" igual que un input vacío: para el resto del módulo son la misma cosa.
function normalizarPerfil({ nombre, apellidos, telefono } = {}) {
  return {
    nombre: aTexto(nombre),
    apellidos: aTexto(apellidos),
    telefono: aTexto(telefono),
  };
}

function validarCampoRequerido(campo, valor) {
  if (!valor) {
    return {
      ok: false,
      campo,
      mensaje: campo === "nombre" ? "El nombre es obligatorio." : "Los apellidos son obligatorios.",
    };
  }
  // String iteration counts Unicode code points, así un emoji cuenta como 1
  // igual que lo vería el usuario, no como las 2 unidades UTF-16 que da .length.
  if ([...valor].length > LONGITUD_MAXIMA_NOMBRE_PERFIL) {
    return {
      ok: false,
      campo,
      mensaje: `No puede superar los ${LONGITUD_MAXIMA_NOMBRE_PERFIL} caracteres.`,
    };
  }
  return { ok: true };
}

function validarTelefono(valor) {
  // El teléfono es opcional: "" es un valor válido que significa "no cargado".
  if (valor && !PATRON_TELEFONO_PERFIL.test(valor)) {
    return {
      ok: false,
      campo: "telefono",
      mensaje: "El teléfono debe incluir el código de país, ej. +525512345678.",
    };
  }
  return { ok: true };
}

function validarPerfil({ nombre, apellidos, telefono } = {}) {
  const datos = normalizarPerfil({ nombre, apellidos, telefono });

  const resultadoNombre = validarCampoRequerido("nombre", datos.nombre);
  if (!resultadoNombre.ok) return resultadoNombre;

  const resultadoApellidos = validarCampoRequerido("apellidos", datos.apellidos);
  if (!resultadoApellidos.ok) return resultadoApellidos;

  return validarTelefono(datos.telefono);
}

/*
  Valida SOLO los campos presentes en `cambios` (el resultado de
  camposModificados). Así, un dato legacy inválido en un campo que el usuario
  no tocó (ej. un teléfono viejo guardado con espacios) nunca bloquea guardar
  un cambio en otro campo: solo lo que se va a escribir se valida.
*/
function validarCambios(cambios) {
  if ("nombre" in cambios) {
    const resultado = validarCampoRequerido("nombre", cambios.nombre);
    if (!resultado.ok) return resultado;
  }
  if ("apellidos" in cambios) {
    const resultado = validarCampoRequerido("apellidos", cambios.apellidos);
    if (!resultado.ok) return resultado;
  }
  if ("telefono" in cambios) {
    const resultado = validarTelefono(cambios.telefono);
    if (!resultado.ok) return resultado;
  }
  return { ok: true };
}

/*
  null (de la BD) y "" (de un input vacío) representan el mismo "sin dato": no
  deben aparecer como un cambio. Devuelve solo las claves que de verdad
  cambiaron, {} si el formulario coincide con lo guardado.
*/
function camposModificados(original, actual) {
  const base = normalizarPerfil(original);
  const nuevo = normalizarPerfil(actual);
  const cambios = {};

  ["nombre", "apellidos", "telefono"].forEach((campo) => {
    if (base[campo] !== nuevo[campo]) cambios[campo] = nuevo[campo];
  });

  return cambios;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    LONGITUD_MAXIMA_NOMBRE_PERFIL,
    PATRON_TELEFONO_PERFIL,
    normalizarPerfil,
    validarPerfil,
    validarCambios,
    camposModificados,
  });
}

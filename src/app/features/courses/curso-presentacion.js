/*
  Formato de los datos de un curso para las tarjetas del catálogo. Es capa de
  presentación: no consulta Supabase ni conoce el esquema, solo traduce campos a
  texto para el usuario final. Debe cargarse antes que cursos.js.
*/

const OPCIONES_FECHA_CURSO = { day: "numeric", month: "short" };
const LOCALE_CURSO = "es-MX";
const MINUTOS_POR_DIA = 1440;
const PATRON_HORA = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;

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

function formatearFechaCorta(fecha) {
  return parsearFechaLocal(fecha).toLocaleDateString(LOCALE_CURSO, OPCIONES_FECHA_CURSO);
}

// "1 mar – 30 abr". null si no hay al menos una fecha.
function formatearRangoFechas(curso) {
  if (!curso.fecha_inicio) return null;
  const inicio = formatearFechaCorta(curso.fecha_inicio);
  if (!curso.fecha_fin) return inicio;
  return `${inicio} – ${formatearFechaCorta(curso.fecha_fin)}`;
}

// Minutos desde medianoche a "HH:MM", dando la vuelta al pasar de las 24 h.
function formatearMinutosDelDia(minutosTotales) {
  const minutosDelDia = ((minutosTotales % MINUTOS_POR_DIA) + MINUTOS_POR_DIA) % MINUTOS_POR_DIA;
  const hora = String(Math.floor(minutosDelDia / 60)).padStart(2, "0");
  const minuto = String(minutosDelDia % 60).padStart(2, "0");
  return `${hora}:${minuto}`;
}

// Rango en formato de 24 horas, calculado con la hora inicial y la duración.
// La duración se captura en el formulario, pero no se muestra en las tarjetas.
function formatearHorario(curso) {
  if (typeof curso.hora_inicio !== "string") return null;
  const partesHora = PATRON_HORA.exec(curso.hora_inicio);
  if (!partesHora) return null;

  const inicioEnMinutos = Number(partesHora[1]) * 60 + Number(partesHora[2]);
  const inicio = formatearMinutosDelDia(inicioEnMinutos);

  const duracionEnMinutos = Math.round(Number(curso.duracion_horas) * 60);
  if (!Number.isFinite(duracionEnMinutos) || duracionEnMinutos <= 0) return inicio;

  return `${inicio} - ${formatearMinutosDelDia(inicioEnMinutos + duracionEnMinutos)}`;
}

// "Gratis" si el costo es 0, "$500.00 MXN" si es mayor, null si no se capturó.
function formatearCosto(costo) {
  if (costo === null || costo === undefined) return null;
  if (Number(costo) === 0) return "Gratis";
  return `$${Number(costo).toFixed(2)} MXN`;
}

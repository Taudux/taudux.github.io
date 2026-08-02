/*
  Formato de los datos de un curso para el catálogo y su detalle. Es capa de
  presentación: no consulta Supabase ni conoce el esquema, solo traduce campos a
  texto para el usuario final. Debe cargarse antes que cursos.js y curso-detalle.js.
*/

const OPCIONES_FECHA_CURSO = { day: "numeric", month: "short" };
const LOCALE_CURSO = "es-MX";
const MINUTOS_POR_DIA = 1440;
const PATRON_HORA = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;
// Mismo orden y códigos del check `cursos_dias_validos` (migración 0007): el
// array en la base no garantiza el orden en que se marcaron los checkboxes.
const ORDEN_DIAS_SEMANA = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const NOMBRE_DIA_SEMANA = {
  lun: "lunes", mar: "martes", mie: "miércoles", jue: "jueves",
  vie: "viernes", sab: "sábado", dom: "domingo",
};

// Etiqueta de modalidad para el badge de la tarjeta. null si no se capturó.
function etiquetaModalidad(curso) {
  if (curso.modalidad === "presencial") return "Presencial";
  if (curso.modalidad === "en_linea") return "En línea";
  return null;
}

// "Lunes y jueves", "Lunes, miércoles y viernes". null si no hay días capturados.
// No se usa en la tarjeta del catálogo, que nunca mostró días; solo en el detalle.
function formatearDiasSemana(curso) {
  if (!Array.isArray(curso.dias_semana) || curso.dias_semana.length === 0) return null;

  const nombres = ORDEN_DIAS_SEMANA
    .filter((codigo) => curso.dias_semana.includes(codigo))
    .map((codigo) => NOMBRE_DIA_SEMANA[codigo]);
  if (nombres.length === 0) return null;

  const lista = nombres.length === 1
    ? nombres[0]
    : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  return lista.charAt(0).toUpperCase() + lista.slice(1);
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

// Traduce **negrita** a <strong> dentro de `contenedor`. `descripcion` la
// carga un admin, no un usuario final, pero el criterio del sitio es no
// confiarle innerHTML a ningún dato de la base: split con grupo de captura
// deja los tramos en negrita en los índices impares, el resto es texto plano.
function agregarTextoConNegritas(contenedor, texto) {
  texto.split(/\*\*(.+?)\*\*/g).forEach((parte, indice) => {
    if (!parte) return;
    if (indice % 2 === 1) {
      const fuerte = document.createElement("strong");
      fuerte.textContent = parte;
      contenedor.appendChild(fuerte);
    } else {
      contenedor.appendChild(document.createTextNode(parte));
    }
  });
}

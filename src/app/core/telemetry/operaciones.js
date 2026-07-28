/*
  Telemetría de operaciones, compartida por todas las pantallas. No depende de
  supabaseClient ni de ningún servicio: puede cargarse sola.

  El contrato es local y sanitizado a propósito, para que un listener de
  producción recolecte errores sin recibir títulos, IDs, nombres, payloads ni
  mensajes de Supabase.
*/

function iniciarMedicionOperacion() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function duracionOperacion(inicio) {
  return Math.max(0, Math.round((iniciarMedicionOperacion() - inicio) * 100) / 100);
}

function valorTelemetriaSeguro(valor, predeterminado) {
  const texto = typeof valor === "string" ? valor : "";
  return /^[a-zA-Z0-9:_-]{1,64}$/.test(texto) ? texto : predeterminado;
}

function reportarErrorOperacion({ operacion, pagina, error = null, codigo = null, inicio }) {
  const detalle = Object.freeze({
    operation: valorTelemetriaSeguro(operacion, "unknown_operation"),
    page: valorTelemetriaSeguro(pagina, "unknown_page"),
    code: valorTelemetriaSeguro(codigo || error?.code, "unknown_error"),
    durationMs: duracionOperacion(inicio),
  });
  console.error("[taudux:operation-error]", detalle);
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function" &&
    typeof CustomEvent === "function"
  ) {
    window.dispatchEvent(new CustomEvent("taudux:operation-error", { detail: detalle }));
  }
  return detalle;
}

// Ata la telemetría a una página para que cada controlador deje de repetir el
// mismo par de envoltorios. Degrada a consola si el módulo no se cargó.
function crearReporteroOperaciones(pagina) {
  return Object.freeze({
    iniciarTiempo: iniciarMedicionOperacion,
    reportarFallo(operacion, error, inicio, codigo) {
      reportarErrorOperacion({ operacion, pagina, error, codigo, inicio });
    },
  });
}

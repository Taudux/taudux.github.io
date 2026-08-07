/*
  Carga e inicializa Google Analytics 4. Un solo lugar con el Measurement ID
  real, para no repetirlo a mano en cada una de las páginas que lo cargan
  (este repo no tiene build ni sistema de layouts compartido).

  Sólo mide uso agregado del sitio (páginas vistas, tiempo de permanencia) —
  ver la sección 5 y 9 de /app/features/legal/privacidad.html. No se dispara
  ningún evento de negocio desde acá: las altas y bajas de cuenta viven en
  la tabla eventos_negocio de Supabase (migración 0027), que sobrevive al
  borrado de la cuenta y no depende de que el navegador siga ejecutando JS.

  Propiedad "Taudux" / stream "taudux.com", creada el 2026-08-07.
*/

const GA4_MEASUREMENT_ID = "G-JDE7X7GFE5";

window.dataLayer = window.dataLayer || [];
function gtag() {
  window.dataLayer.push(arguments);
}
gtag("js", new Date());
gtag("config", GA4_MEASUREMENT_ID);

const gtagScript = document.createElement("script");
gtagScript.async = true;
gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`;
document.head.appendChild(gtagScript);

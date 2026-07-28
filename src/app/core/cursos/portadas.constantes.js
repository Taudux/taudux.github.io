/*
  Contrato compartido de las portadas gestionadas: dónde viven en Storage y qué
  forma tienen los identificadores que las asocian a un curso. Lo consumen el
  servicio de cursos, el cliente de portadas y el formulario de administración,
  que antes repetían estos literales por separado.

  Sin dependencias: puede cargarse antes que supabaseClient.
*/

const URL_PUBLICA_PORTADAS =
  "https://yqkvgfqplmbbcebrivpt.supabase.co/storage/v1/object/public/course-covers/";

// El servidor es quien nombra el archivo: sha256/<digest>.<extensión>.
const RUTA_PORTADA_GESTIONADA = /^sha256\/[0-9a-f]{64}\.(?:jpg|png|webp)$/;

// Token de asociación emitido por la edge function. Acepta versiones 1 a 8
// porque lo genera el servidor, no el navegador.
const UUID_TOKEN_PORTADA =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ID de operación de creación: exigimos v4 porque lo genera crypto.randomUUID.
const UUID_OPERACION_CURSO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function urlPublicaPortada(rutaStorage) {
  return `${URL_PUBLICA_PORTADAS}${rutaStorage}`;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    URL_PUBLICA_PORTADAS,
    RUTA_PORTADA_GESTIONADA,
    UUID_TOKEN_PORTADA,
    UUID_OPERACION_CURSO,
    urlPublicaPortada,
  });
}

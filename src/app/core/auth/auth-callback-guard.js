/*
  Red de seguridad ante un callback de Supabase Auth mal aterrizado.

  El correo de confirmación/recuperación pide un `emailRedirectTo` a la página
  correcta (ver auth.service.js), pero Supabase cae en silencio al Site URL del
  dashboard cuando ese destino no está en la allowlist de Redirect URLs. Esa
  mala configuración es invisible desde el código y deja al usuario mirando un
  `#access_token=...` crudo en la raíz del sitio.

  Este guard es la última línea de defensa: si el hash trae marcas de un
  callback de auth y la página actual no es ya la que sabe procesarlo,
  redirige preservando el hash íntegro (los tokens viajan ahí).

  Se carga en index.html ANTES que supabase-client.js a propósito: supabase-js
  corre con `detectSessionInUrl: true` por defecto y consume/limpia el hash
  apenas se crea el cliente. Si este guard corriera después, llegaría tarde.

  Por el mismo motivo de orden de carga no puede reusar RUTAS_AUTH de
  auth.service.js (ese script todavía no cargó) — las rutas se duplican acá;
  un test asegura que ambas listas coincidan.
*/

const RUTAS_CALLBACK_AUTH = Object.freeze({
  confirm: "/app/features/auth/confirm/",
  resetPassword: "/app/features/auth/reset-password/",
});

/*
  Núcleo puro: a partir de pathname/hash/search actuales, decide a dónde
  redirigir. Devuelve null cuando no hay nada que hacer (sin hash relevante,
  o ya en la página que sabe procesarlo) para no generar un loop de replace.
*/
function destinoCallbackAuth(pathname, hash, search) {
  const params = new URLSearchParams((hash || "").replace(/^#/, ""));
  const tipo = params.get("type");
  const esConfirmacion = params.has("access_token") || tipo === "signup";
  const esRecuperacion = tipo === "recovery";

  if (!esConfirmacion && !esRecuperacion) return null;

  const rutaDestino = esRecuperacion
    ? RUTAS_CALLBACK_AUTH.resetPassword
    : RUTAS_CALLBACK_AUTH.confirm;

  if (pathname === rutaDestino) return null;

  return `${rutaDestino}${search || ""}${hash || ""}`;
}

if (typeof window !== "undefined" && typeof module !== "object") {
  const destino = destinoCallbackAuth(
    window.location.pathname,
    window.location.hash,
    window.location.search,
  );
  if (destino) window.location.replace(destino);
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    RUTAS_CALLBACK_AUTH,
    destinoCallbackAuth,
  });
}

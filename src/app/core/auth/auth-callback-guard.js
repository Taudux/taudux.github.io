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
  oauthCallback: "/app/features/auth/oauth-callback/",
});

/*
  Núcleo puro: a partir de pathname/hash/search actuales, decide a dónde
  redirigir. Devuelve null cuando no hay nada que hacer (sin marcas
  relevantes, o ya en la página que sabe procesarlo) para no generar un loop
  de replace.

  Con PKCE, el `?code=` de OAuth y el de un enlace de correo mal aterrizado
  son indistinguibles por sí solos: Supabase no agrega un discriminador y
  depura los parámetros propios de redirectTo. Por eso los enlaces de correo
  se emiten con `token_hash` + `type` (ver auth.service.js / confirm.js /
  reset-password.js), y un `?code=` SIN token_hash queda reservado a OAuth.
*/
function destinoCallbackAuth(pathname, hash, search) {
  const fragmento = new URLSearchParams((hash || "").replace(/^#/, ""));
  const consulta = new URLSearchParams(search || "");
  const tipo = fragmento.get("type") || consulta.get("type");

  const esRecuperacion = tipo === "recovery";
  const esConfirmacion = fragmento.has("access_token") || tipo === "signup" || tipo === "email";
  const esOauth = consulta.has("code") && !consulta.has("token_hash");

  let rutaDestino = null;
  if (esRecuperacion) rutaDestino = RUTAS_CALLBACK_AUTH.resetPassword;
  else if (esConfirmacion) rutaDestino = RUTAS_CALLBACK_AUTH.confirm;
  else if (esOauth) rutaDestino = RUTAS_CALLBACK_AUTH.oauthCallback;

  if (!rutaDestino || pathname === rutaDestino) return null;

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

/*
  Detecta si un usuario tiene una identidad "email" (y por lo tanto puede tener
  contraseña) o si sólo entró por un proveedor OAuth como Google.

  user.identities manda: es el reflejo directo de las filas de auth.identities,
  una por proveedor vinculado, y cambia en el momento en que se vincula o
  desvincula un proveedor. app_metadata.providers es sólo fallback cuando
  identities falta o no es un array: viaja denormalizado dentro del JWT, así
  que una sesión emitida antes de un link/unlink puede arrastrar el array
  viejo hasta que el token se refresque. app_metadata.provider (escalar) es el
  último recurso.

  Ante la duda se asume que NO hay identidad email. La asimetría de daño lo
  justifica: un falso "sin contraseña" en el peor caso ofrece establecer una
  que ya existe (molesto, nunca bloqueante); un falso "con contraseña"
  reproduce el bug que este archivo existe para arreglar — una cuenta Google
  que no puede cambiar ni eliminarse porque el portal exige una contraseña
  que nunca tuvo.

  identities no basta por sí solo: Supabase no agrega una identidad "email" al
  llamar updateUser({password}) sobre una cuenta OAuth-only (verificado en
  producción el 2026-08-06 — una cuenta Google que ya había creado su
  contraseña seguía mostrando identities: [{provider:"google"}] tras volver a
  entrar con Google). Por eso cambiarContrasena() marca
  user_metadata.tiene_contrasena = true al guardar la contraseña, y esa marca
  es el segundo criterio: la única señal que persiste correctamente el hecho
  de que la cuenta ya tiene una contraseña utilizable.
*/

const PROVEEDOR_CONTRASENA = "email";

function proveedoresDeUsuario(user) {
  if (!user) return [];

  if (Array.isArray(user.identities)) {
    return user.identities
      .map((identidad) => String(identidad?.provider || "").toLowerCase())
      .filter(Boolean);
  }

  const providers = user.app_metadata?.providers;
  if (Array.isArray(providers)) {
    return providers.map((p) => String(p || "").toLowerCase()).filter(Boolean);
  }

  const provider = user.app_metadata?.provider;
  if (provider) return [String(provider).toLowerCase()];

  return [];
}

function puedeUsarContrasena(user) {
  if (proveedoresDeUsuario(user).includes(PROVEEDOR_CONTRASENA)) return true;
  return user?.user_metadata?.tiene_contrasena === true;
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    PROVEEDOR_CONTRASENA,
    proveedoresDeUsuario,
    puedeUsarContrasena,
  });
}

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (relativo) => fs.readFileSync(path.join(ROOT, relativo), "utf8");
const AUTH_SERVICE_SOURCE = read("src/app/core/auth/auth.service.js");

const {
  proveedoresDeUsuario,
  puedeUsarContrasena,
} = require("../src/app/core/auth/auth-identidades.js");

/* Bloque A — auth-identidades.js, corrido de verdad vía require. */

test("una identidad email habilita el camino de contraseña", () => {
  assert.equal(puedeUsarContrasena({ identities: [{ provider: "email" }] }), true);
});

test("una única identidad google no habilita el camino de contraseña", () => {
  assert.equal(puedeUsarContrasena({ identities: [{ provider: "google" }] }), false);
});

test("una cuenta vinculada (google + email) habilita el camino de contraseña", () => {
  const user = { identities: [{ provider: "google" }, { provider: "email" }] };
  assert.equal(puedeUsarContrasena(user), true);
});

test("identities manda sobre app_metadata.providers, aunque estén en desacuerdo", () => {
  const user = {
    identities: [{ provider: "google" }],
    app_metadata: { providers: ["email"] },
  };
  assert.equal(puedeUsarContrasena(user), false);
});

test("app_metadata.providers es fallback cuando identities no es un array", () => {
  const user = {
    identities: undefined,
    app_metadata: { providers: ["email", "google"] },
  };
  assert.equal(puedeUsarContrasena(user), true);
});

test("app_metadata.provider escalar es el último recurso", () => {
  const user = { app_metadata: { provider: "email" } };
  assert.equal(puedeUsarContrasena(user), true);
});

test("sin ninguna señal, se asume sin contraseña (fail-open al enlace, nunca deja trabado)", () => {
  assert.equal(puedeUsarContrasena(undefined), false);
  assert.equal(puedeUsarContrasena(null), false);
  assert.equal(puedeUsarContrasena({}), false);
  assert.equal(puedeUsarContrasena({ identities: [] }), false);
});

test("proveedoresDeUsuario normaliza a minúsculas y descarta vacíos", () => {
  const user = { identities: [{ provider: "GOOGLE" }, { provider: "" }, { provider: null }] };
  assert.deepEqual(proveedoresDeUsuario(user), ["google"]);
});

/*
  Verificado en producción el 2026-08-06: updateUser({password}) NO agrega una
  identidad "email" a una cuenta OAuth-only — identities sigue listando sólo
  google después de crear la contraseña y volver a entrar con Google. Por eso
  user_metadata.tiene_contrasena es un segundo criterio, no un adorno.
*/

test("user_metadata.tiene_contrasena habilita el camino de contraseña aunque identities sólo tenga google", () => {
  const user = {
    identities: [{ provider: "google" }],
    user_metadata: { tiene_contrasena: true },
  };
  assert.equal(puedeUsarContrasena(user), true);
});

test("user_metadata.tiene_contrasena en false (o ausente) no habilita nada por sí solo", () => {
  assert.equal(puedeUsarContrasena({ identities: [{ provider: "google" }], user_metadata: {} }), false);
  assert.equal(
    puedeUsarContrasena({ identities: [{ provider: "google" }], user_metadata: { tiene_contrasena: false } }),
    false
  );
});

/* Bloque B — contratos de markup: los avisos nacen ocultos y reusan la regla
   .portal__form[hidden] que ya existe (ver portal.css), en vez de inventar una
   clase nueva sin su [hidden] hermano. */

test("el aviso de contraseña ausente nace hidden y reusa la clase portal__form", () => {
  const html = read("src/app/features/portal/index.html");
  const bloque = html.match(/<div class="portal__form" id="avisoSinContrasena"[^>]*>/);
  assert.ok(bloque, "avisoSinContrasena not found");
  assert.match(bloque[0], /\bhidden\b/);
  assert.match(html, /id="botonEnlaceContrasena"/);
});

test("el aviso de contraseña ausente en eliminar-cuenta nace hidden y reusa la clase portal__form", () => {
  const html = read("src/app/features/portal/index.html");
  const bloque = html.match(/<div class="portal__form" id="avisoSinContrasenaEliminar"[^>]*>/);
  assert.ok(bloque, "avisoSinContrasenaEliminar not found");
  assert.match(bloque[0], /\bhidden\b/);
  assert.match(html, /id="botonEnlaceEliminarCuenta"/);
});

test("ambas regiones de resultado del envío son role=status, no role=alert: son confirmación, no error", () => {
  const html = read("src/app/features/portal/index.html");
  assert.match(html, /id="avisoSinContrasenaEstado"[^>]*role="status"/);
  assert.match(html, /id="avisoSinContrasenaEliminarEstado"[^>]*role="status"/);
});

test("el portal carga auth-identidades.js antes que portal.js", () => {
  const html = read("src/app/features/portal/index.html");
  const identidades = html.indexOf("auth/auth-identidades.js");
  const portal = html.indexOf("portal/portal.js");
  assert.ok(identidades > -1 && portal > -1, "faltan los <script> esperados");
  assert.ok(identidades < portal, "auth-identidades.js debe cargar antes que portal.js");
});

/* Bloque C — invariante de la rama en portal.js: la detección de proveedor se
   consulta antes de la re-autenticación con contraseña, en las dos funciones. */

test("configurarFormularioContrasena consulta puedeUsarContrasena antes de signInWithPassword", () => {
  const js = read("src/app/features/portal/portal.js");
  const cuerpo = js.match(/function configurarFormularioContrasena\(session\)\s*{[\s\S]*?\n  }/)[0];
  const deteccion = cuerpo.indexOf("puedeUsarContrasena(");
  const reauth = cuerpo.indexOf("signInWithPassword");
  assert.ok(deteccion >= 0 && reauth >= 0, "faltan ambas llamadas");
  assert.ok(deteccion < reauth, "la detección de proveedor debe ir antes de signInWithPassword");
});

test("configurarEliminarCuenta consulta puedeUsarContrasena antes de signInWithPassword", () => {
  const js = read("src/app/features/portal/portal.js");
  const cuerpo = js.match(/function configurarEliminarCuenta\(session\)\s*{[\s\S]*?\n  }/)[0];
  const deteccion = cuerpo.indexOf("puedeUsarContrasena(");
  const reauth = cuerpo.indexOf("signInWithPassword");
  assert.ok(deteccion >= 0 && reauth >= 0, "faltan ambas llamadas");
  assert.ok(deteccion < reauth, "la detección de proveedor debe ir antes de signInWithPassword");
});

test("el camino sin contraseña reusa recuperarContrasena, no un mecanismo de auth nuevo", () => {
  const js = read("src/app/features/portal/portal.js");
  assert.match(js, /await recuperarContrasena\(email\)/);
});

/* Bloque D — cambiarContrasena marca user_metadata.tiene_contrasena, corrido
   vía vm con un supabaseClient falso (patrón de tests/oauth-google.test.js). */

function crearContextoAuthService(updateUserImpl) {
  const calls = [];
  const context = {
    window: { location: { origin: "https://taudux.com" } },
    supabaseClient: {
      auth: {
        async updateUser(args) {
          calls.push(args);
          return updateUserImpl(args);
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(AUTH_SERVICE_SOURCE, context);
  return { calls, context };
}

test("cambiarContrasena manda la password y marca tiene_contrasena:true en el mismo updateUser", async () => {
  const { calls, context } = crearContextoAuthService(() => ({ data: {}, error: null }));
  const resultado = await context.cambiarContrasena("Nueva123abc");

  assert.equal(resultado.ok, true);
  assert.equal(calls.length, 1);
  const [llamada] = calls;
  assert.equal(llamada.password, "Nueva123abc");
  assert.equal(llamada.data.tiene_contrasena, true);
});

test("cambiarContrasena traduce el error y no rompe si updateUser falla", async () => {
  const { context } = crearContextoAuthService(() => ({
    data: null,
    error: { code: "same_password" },
  }));
  const resultado = await context.cambiarContrasena("igual-de-antes");

  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, "same_password");
});

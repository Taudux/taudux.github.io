const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RUTAS_CALLBACK_AUTH,
  destinoCallbackAuth,
} = require("../src/app/core/auth/auth-callback-guard.js");

test("hash de confirmación en la raíz redirige a la página de confirm con el hash intacto", () => {
  const hash = "#access_token=abc123&expires_at=1&type=signup";
  assert.equal(
    destinoCallbackAuth("/", hash, ""),
    `${RUTAS_CALLBACK_AUTH.confirm}${hash}`,
  );
});

test("type=signup sin access_token también cuenta como confirmación", () => {
  const hash = "#type=signup";
  assert.equal(
    destinoCallbackAuth("/", hash, ""),
    `${RUTAS_CALLBACK_AUTH.confirm}${hash}`,
  );
});

test("hash de recuperación redirige a reset-password, no a confirm", () => {
  const hash = "#access_token=xyz&type=recovery";
  assert.equal(
    destinoCallbackAuth("/", hash, ""),
    `${RUTAS_CALLBACK_AUTH.resetPassword}${hash}`,
  );
});

test("ya estando en la página de confirm no redirige (evita loop)", () => {
  const hash = "#access_token=abc123&type=signup";
  assert.equal(destinoCallbackAuth(RUTAS_CALLBACK_AUTH.confirm, hash, ""), null);
});

test("ya estando en reset-password no redirige (evita loop)", () => {
  const hash = "#access_token=abc123&type=recovery";
  assert.equal(destinoCallbackAuth(RUTAS_CALLBACK_AUTH.resetPassword, hash, ""), null);
});

test("sin hash no hace nada", () => {
  assert.equal(destinoCallbackAuth("/", "", ""), null);
});

test("hash irrelevante (ancla de navegación) no hace nada", () => {
  assert.equal(destinoCallbackAuth("/", "#planes", ""), null);
});

test("preserva la query string junto con el hash", () => {
  const hash = "#access_token=abc123&type=signup";
  assert.equal(
    destinoCallbackAuth("/", hash, "?ref=correo"),
    `${RUTAS_CALLBACK_AUTH.confirm}?ref=correo${hash}`,
  );
});

test("las rutas del guard coinciden con RUTAS_AUTH de auth.service.js", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync("src/app/core/auth/auth.service.js", "utf8");
  const context = { window: { location: { origin: "https://taudux.com" } } };
  vm.createContext(context);
  vm.runInContext(source + "\nthis.__RUTAS_AUTH = RUTAS_AUTH;", context);

  assert.equal(RUTAS_CALLBACK_AUTH.confirm, context.__RUTAS_AUTH.confirm);
  assert.equal(RUTAS_CALLBACK_AUTH.resetPassword, context.__RUTAS_AUTH.resetPassword);
});

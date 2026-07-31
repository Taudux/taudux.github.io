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

test("un ?code= suelto es OAuth y va a la página de callback", () => {
  assert.equal(
    destinoCallbackAuth("/", "", "?code=abc-123"),
    `${RUTAS_CALLBACK_AUTH.oauthCallback}?code=abc-123`,
  );
});

test("token_hash de recuperación gana sobre el code y va a reset-password", () => {
  const search = "?token_hash=pkce_xyz&type=recovery";
  assert.equal(
    destinoCallbackAuth("/", "", search),
    `${RUTAS_CALLBACK_AUTH.resetPassword}${search}`,
  );
});

test("token_hash de confirmación va a confirm", () => {
  const search = "?token_hash=pkce_xyz&type=signup";
  assert.equal(
    destinoCallbackAuth("/", "", search),
    `${RUTAS_CALLBACK_AUTH.confirm}${search}`,
  );
});

test("ya en oauth-callback no redirige (evita loop)", () => {
  assert.equal(destinoCallbackAuth(RUTAS_CALLBACK_AUTH.oauthCallback, "", "?code=abc"), null);
});

test("un ?next= no dispara ningún callback", () => {
  assert.equal(
    destinoCallbackAuth("/", "", "?next=%2Fapp%2Ffeatures%2Fportal%2F"),
    null,
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

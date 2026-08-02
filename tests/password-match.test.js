const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const { estadoCoincidenciaContrasenas } = require(
  path.join(ROOT, "src/app/features/auth/auth-ui.js")
);

/* Bloque A — núcleo puro. */

test("sin confirmación aún, el estado es neutral", () => {
  assert.equal(estadoCoincidenciaContrasenas("Passw0rd", ""), "neutral");
});

test("contraseñas distintas producen mismatch", () => {
  assert.equal(estadoCoincidenciaContrasenas("Passw0rd", "different"), "mismatch");
});

test("coinciden pero no cumplen los requisitos de seguridad: debil", () => {
  assert.equal(estadoCoincidenciaContrasenas("abc", "abc"), "debil");
});

test("coinciden y cumplen los requisitos: ok", () => {
  assert.equal(estadoCoincidenciaContrasenas("Passw0rd", "Passw0rd"), "ok");
});

/* Bloque B — CSS. */

test("field.css agrega el feedback en vivo para data-match ok y mismatch", () => {
  const css = read("src/app/shared/field/field.css");
  assert.match(
    css,
    /\.field\[data-match="ok"\]\s*{[^}]*border-color:\s*var\(--color-success\)/
  );
  assert.match(
    css,
    /\.field\[data-match="mismatch"\]\s*{[^}]*border-color:\s*var\(--color-error\)/
  );
});

test("field.css conserva intacta la regla de error de envío aria-invalid", () => {
  const css = read("src/app/shared/field/field.css");
  assert.match(css, /\.field\[aria-invalid="true"\]\s*{[^}]*border-color:\s*var\(--color-error\)/);
});

/* Bloque C — wire-up en cada página. */

test("reset-password.js configura la coincidencia en vivo", () => {
  const js = read("src/app/features/auth/reset-password/reset-password.js");
  assert.match(js, /configurarCoincidenciaContrasenas\(/);
});

test("signup.js configura la coincidencia en vivo", () => {
  const js = read("src/app/features/auth/signup/signup.js");
  assert.match(js, /configurarCoincidenciaContrasenas\(/);
});

test("portal.js configura la coincidencia en vivo", () => {
  const js = read("src/app/features/portal/portal.js");
  assert.match(js, /configurarCoincidenciaContrasenas\(/);
});

/* Bloque D — regiones en vivo en cada HTML. */

test("reset-password/index.html incluye la región de coincidencia", () => {
  const html = read("src/app/features/auth/reset-password/index.html");
  assert.match(
    html,
    /<p class="password-match" id="resetPasswordMatch" aria-live="polite"><\/p>/
  );
});

test("signup/index.html incluye la región de coincidencia", () => {
  const html = read("src/app/features/auth/signup/index.html");
  assert.match(
    html,
    /<p class="password-match" id="signupPasswordMatch" aria-live="polite"><\/p>/
  );
});

test("portal/index.html incluye la región de coincidencia", () => {
  const html = read("src/app/features/portal/index.html");
  assert.match(
    html,
    /<p class="password-match" id="contrasenaMatch" aria-live="polite"><\/p>/
  );
});

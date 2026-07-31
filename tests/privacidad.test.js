const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(
  path.join(ROOT, "src/app/features/legal/privacidad.html"),
  "utf8"
);

/*
  Blinda la declaración legal que habilita el aviso de curso nuevo por correo
  (opt-out, default true). Si esta declaración desaparece o se afloja, la
  migración 0015 y la edge function de envío quedan operando sin respaldo en
  el aviso de privacidad.
*/

test("privacy notice no longer claims there are no secondary purposes", () => {
  assert.doesNotMatch(html, /Actualmente no tratamos tus datos para finalidades secundarias/);
});

test("privacy notice discloses the new-course email as a secondary purpose", () => {
  assert.match(html, /Avisarte por correo electr(ó|o)nico cuando publicamos un curso nuevo/);
});

test("privacy notice names both opt-out mechanisms: the portal and the email footer link", () => {
  assert.match(html, /Portal de cuenta.{0,40}Preferencias de\s*correo\s*<\/strong>/s);
  assert.match(html, /enlace de baja/);
});

test("privacy notice states opting out does not affect the rest of the service", () => {
  assert.match(html, /Negarte no afecta el resto del servicio/);
});

test("privacy notice extends the Resend disclosure beyond authentication emails", () => {
  const resendBlock = html.slice(html.indexOf("<strong>Resend</strong>"));
  const closingLi = resendBlock.indexOf("</li>");
  const scoped = resendBlock.slice(0, closingLi === -1 ? undefined : closingLi);
  assert.match(scoped, /autenticaci(ó|o)n/);
  assert.match(scoped, /curso/i);
});

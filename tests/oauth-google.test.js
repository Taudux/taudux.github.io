const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const AUTH_SERVICE_SOURCE = fs.readFileSync(
  path.join(ROOT, "src/app/core/auth/auth.service.js"),
  "utf8"
);
const loginHtml = fs.readFileSync(path.join(ROOT, "src/app/features/auth/login/index.html"), "utf8");
const signupHtml = fs.readFileSync(path.join(ROOT, "src/app/features/auth/signup/index.html"), "utf8");
const oauthCallbackHtml = fs.readFileSync(
  path.join(ROOT, "src/app/features/auth/oauth-callback/index.html"),
  "utf8"
);

/* Bloque A — el servicio, corrido vía vm con un supabaseClient falso. */

function crearContextoAuthService() {
  const calls = [];
  const context = {
    window: { location: { origin: "https://taudux.com" } },
    supabaseClient: {
      auth: {
        async signInWithOAuth(args) {
          calls.push(args);
          return { data: {}, error: null };
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(AUTH_SERVICE_SOURCE, context);
  return { calls, context };
}

test("iniciarSesionConGoogle pide el provider google con la redirectTo y el prompt correctos", async () => {
  const { calls, context } = crearContextoAuthService();
  const resultado = await context.iniciarSesionConGoogle();

  assert.equal(resultado.ok, true);
  assert.equal(calls.length, 1);
  const [llamada] = calls;
  assert.equal(llamada.provider, "google");
  assert.equal(llamada.options.redirectTo, "https://taudux.com/app/features/auth/oauth-callback/");
  assert.equal(llamada.options.queryParams.prompt, "select_account");
  assert.equal(llamada.options.scopes, undefined);
  assert.equal(llamada.options.skipBrowserRedirect, undefined);
});

test("iniciarSesionConGoogle traduce un error del proveedor a un mensaje ok:false", async () => {
  const context = {
    window: { location: { origin: "https://taudux.com" } },
    supabaseClient: {
      auth: {
        async signInWithOAuth() {
          return { data: null, error: { code: "provider_disabled" } };
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(AUTH_SERVICE_SOURCE, context);

  const resultado = await context.iniciarSesionConGoogle();
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, "provider_disabled");
  assert.match(resultado.mensaje, /Google/);
});

/* Bloque B — markup como string: el botón existe, es accesible, y aparece
   antes del form. */

for (const [nombre, html] of [
  ["login", loginHtml],
  ["signup", signupHtml],
]) {
  test(`${nombre}: el botón de Google es un <button type="button"> antes del <form>`, () => {
    assert.match(html, /<button type="button" class="auth__oauth button" id="googleButton">/);
    const indiceBoton = html.indexOf('id="googleButton"');
    const indiceForm = html.indexOf("<form");
    assert.ok(indiceBoton > -1 && indiceForm > -1 && indiceBoton < indiceForm);
  });

  test(`${nombre}: el ícono de Google no interfiere con lectores de pantalla`, () => {
    assert.match(html, /<svg class="auth__oauth-icon" aria-hidden="true" focusable="false"/);
  });

  test(`${nombre}: el separador "o" tiene role="separator", no es contenido suelto`, () => {
    assert.match(html, /class="auth__separator" role="separator"/);
  });
}

test("oauth-callback/index.html carga los scripts en el mismo orden que el resto de auth", () => {
  const orden = [
    "supabase-js@2",
    "/app/core/supabase/supabase-client.js",
    "/app/core/auth/auth.service.js",
    "/app/features/auth/auth-ui.js",
    "/app/features/auth/oauth-callback/oauth-callback.js",
  ];
  let ultimoIndice = -1;
  for (const fragmento of orden) {
    const indice = oauthCallbackHtml.indexOf(fragmento);
    assert.ok(indice > ultimoIndice, `${fragmento} debe cargar después de lo anterior`);
    ultimoIndice = indice;
  }
});

/* Bloque C — regresión del shim: el hack que mandaba cualquier ?code= a
   reset-password no puede volver, porque con PKCE eso rompería tanto OAuth
   como la confirmación de correo. */

test("login/index.html ya no manda ?code= a reset-password a mano", () => {
  assert.doesNotMatch(loginHtml, /query\.has\("code"\)/);
});

test("login/index.html carga auth-callback-guard.js en el <head>", () => {
  assert.match(loginHtml, /<head>[\s\S]*auth-callback-guard\.js[\s\S]*<\/head>/);
});

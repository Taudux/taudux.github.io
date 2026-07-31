const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const {
  SECCIONES_PORTAL,
  resolverSeccionActiva,
} = require(path.join(ROOT, "src/app/features/portal/portal.secciones.js"));

const {
  normalizarPerfil,
  validarPerfil,
  validarCambios,
  camposModificados,
} = require(path.join(ROOT, "src/app/features/portal/portal.perfil.js"));

const {
  normalizarPreferenciasCorreo,
  cambiosPreferenciasCorreo,
} = require(path.join(ROOT, "src/app/features/portal/portal.correo.js"));

/* Bloque A — núcleo puro. */

test("the portal section catalog exposes unique, non-empty ids", () => {
  assert.ok(SECCIONES_PORTAL.length > 0);
  const ids = SECCIONES_PORTAL.map((seccion) => seccion.id);
  ids.forEach((id) => {
    assert.equal(typeof id, "string");
    assert.notEqual(id.trim(), "");
  });
  assert.equal(new Set(ids).size, ids.length);
  SECCIONES_PORTAL.forEach((seccion) => {
    assert.equal(typeof seccion.etiqueta, "string");
    assert.notEqual(seccion.etiqueta.trim(), "");
    assert.equal(typeof seccion.disponible, "boolean");
  });
});

test("the active section resolves from a hash with or without the leading marker", () => {
  assert.equal(resolverSeccionActiva("#cuenta"), "cuenta");
  assert.equal(resolverSeccionActiva("cuenta"), "cuenta");
  assert.equal(resolverSeccionActiva("#perfil"), "perfil");
});

test("a missing or empty hash falls back to the first section", () => {
  const primera = SECCIONES_PORTAL[0].id;
  assert.equal(primera, "perfil");
  assert.equal(resolverSeccionActiva(""), primera);
  assert.equal(resolverSeccionActiva(undefined), primera);
  assert.equal(resolverSeccionActiva(null), primera);
  assert.equal(resolverSeccionActiva("#"), primera);
});

test("an unknown or hostile hash never resolves to undefined", () => {
  const primera = SECCIONES_PORTAL[0].id;
  assert.equal(resolverSeccionActiva("#<script>"), primera);
  assert.equal(resolverSeccionActiva("#no-existe"), primera);
  assert.equal(resolverSeccionActiva("#../perfil"), primera);
  assert.equal(resolverSeccionActiva(42), primera);
});

test("an unavailable section is still a valid destination", () => {
  /*
    "Pronto" no significa "no existe": la sección se abre y explica qué falta.
    Redirigir a perfil dejaría al usuario sin entender por qué su clic no hizo
    nada.
  */
  const pagos = SECCIONES_PORTAL.find((seccion) => seccion.id === "pagos");
  assert.equal(pagos.disponible, false);
  assert.equal(resolverSeccionActiva("#pagos"), "pagos");
  assert.equal(resolverSeccionActiva("#plan"), "plan");
  assert.equal(resolverSeccionActiva("#correo"), "correo");
});

/* Bloque B — núcleo puro del formulario "Editar Perfil". */

test("normalizarPerfil trims the three fields and turns null/undefined into empty strings", () => {
  assert.deepEqual(
    normalizarPerfil({ nombre: "  Ana  ", apellidos: "  Pérez ", telefono: " +525512345678 " }),
    { nombre: "Ana", apellidos: "Pérez", telefono: "+525512345678" }
  );
  assert.deepEqual(
    normalizarPerfil({ nombre: null, apellidos: undefined, telefono: null }),
    { nombre: "", apellidos: "", telefono: "" }
  );
  assert.deepEqual(normalizarPerfil(), { nombre: "", apellidos: "", telefono: "" });
});

test("validarPerfil rejects an empty name", () => {
  const resultado = validarPerfil({ nombre: "  ", apellidos: "Pérez", telefono: "" });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.campo, "nombre");
});

test("validarPerfil rejects empty surnames", () => {
  const resultado = validarPerfil({ nombre: "Ana", apellidos: "   ", telefono: "" });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.campo, "apellidos");
});

test("validarPerfil rejects a name past the code-point limit", () => {
  const resultado = validarPerfil({
    nombre: "a".repeat(121),
    apellidos: "Pérez",
    telefono: "",
  });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.campo, "nombre");
});

test("validarPerfil rejects a phone number with letters", () => {
  const resultado = validarPerfil({ nombre: "Ana", apellidos: "Pérez", telefono: "+52abc12345" });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.campo, "telefono");
});

test("validarPerfil rejects a phone number without the leading +", () => {
  const resultado = validarPerfil({ nombre: "Ana", apellidos: "Pérez", telefono: "525512345678" });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.campo, "telefono");
});

test("validarPerfil rejects a phone number that is too short", () => {
  const resultado = validarPerfil({ nombre: "Ana", apellidos: "Pérez", telefono: "+521234" });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.campo, "telefono");
});

test("validarPerfil accepts an empty phone number: it is optional", () => {
  const resultado = validarPerfil({ nombre: "Ana", apellidos: "Pérez", telefono: "" });
  assert.equal(resultado.ok, true);
});

test("validarPerfil accepts a well-formed E.164 phone number", () => {
  const resultado = validarPerfil({ nombre: "Ana", apellidos: "Pérez", telefono: "+525512345678" });
  assert.equal(resultado.ok, true);
});

test("camposModificados returns {} when nothing changed", () => {
  const original = { nombre: "Ana", apellidos: "Pérez", telefono: "+525512345678" };
  const actual = { nombre: "Ana", apellidos: "Pérez", telefono: "+525512345678" };
  assert.deepEqual(camposModificados(original, actual), {});
});

test("camposModificados returns only the field that actually changed", () => {
  const original = { nombre: "Ana", apellidos: "Pérez", telefono: "+525512345678" };
  const actual = { nombre: "Ana", apellidos: "Pérez", telefono: "+525587654321" };
  assert.deepEqual(camposModificados(original, actual), { telefono: "+525587654321" });
});

test("camposModificados treats a null original phone as equivalent to an empty input", () => {
  const original = { nombre: "Ana", apellidos: "Pérez", telefono: null };
  const actual = { nombre: "Ana", apellidos: "Pérez", telefono: "" };
  assert.deepEqual(camposModificados(original, actual), {});
});

test("validarCambios ignores an untouched field even if it holds legacy malformed data", () => {
  // Reproduce el caso real: un teléfono guardado con espacios (dato legacy,
  // nunca producido por el signup actual) no debe bloquear un cambio de nombre.
  const original = { nombre: "Jorge", apellidos: "Estrada", telefono: "+52 4426868988" };
  const actual = { nombre: "Jorge2", apellidos: "Estrada", telefono: "+52 4426868988" };
  const cambios = camposModificados(original, actual);
  assert.deepEqual(cambios, { nombre: "Jorge2" });
  assert.deepEqual(validarCambios(cambios), { ok: true });
});

test("validarCambios still rejects a phone that changed into an invalid value", () => {
  const cambios = { telefono: "+52abc" };
  const resultado = validarCambios(cambios);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.campo, "telefono");
});

test("validarCambios rejects clearing the name to an empty value", () => {
  const cambios = { nombre: "" };
  const resultado = validarCambios(cambios);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.campo, "nombre");
});

/* Bloque B-bis — núcleo puro de "Preferencias de correo". */

test("normalizarPreferenciasCorreo turns null/undefined into false", () => {
  assert.deepEqual(normalizarPreferenciasCorreo({ avisosCursoNuevo: null }), {
    avisosCursoNuevo: false,
  });
  assert.deepEqual(normalizarPreferenciasCorreo({ avisosCursoNuevo: undefined }), {
    avisosCursoNuevo: false,
  });
  assert.deepEqual(normalizarPreferenciasCorreo(), { avisosCursoNuevo: false });
});

test("normalizarPreferenciasCorreo coerces a truthy value to true", () => {
  assert.deepEqual(normalizarPreferenciasCorreo({ avisosCursoNuevo: true }), {
    avisosCursoNuevo: true,
  });
});

test("cambiosPreferenciasCorreo returns {} when the checkbox matches what is saved", () => {
  assert.deepEqual(
    cambiosPreferenciasCorreo({ avisosCursoNuevo: true }, { avisosCursoNuevo: true }),
    {}
  );
  assert.deepEqual(
    cambiosPreferenciasCorreo({ avisosCursoNuevo: null }, { avisosCursoNuevo: false }),
    {}
  );
});

test("cambiosPreferenciasCorreo returns the DB column name when toggled off", () => {
  assert.deepEqual(
    cambiosPreferenciasCorreo({ avisosCursoNuevo: true }, { avisosCursoNuevo: false }),
    { avisos_curso_nuevo: false }
  );
});

test("cambiosPreferenciasCorreo returns the DB column name when toggled on", () => {
  assert.deepEqual(
    cambiosPreferenciasCorreo({ avisosCursoNuevo: false }, { avisosCursoNuevo: true }),
    { avisos_curso_nuevo: true }
  );
});

/* Bloque C — contratos estáticos sobre la fuente. */

test("the portal page stays out of the index", () => {
  const html = read("src/app/features/portal/index.html");
  assert.match(html, /<meta\s+name="robots"\s+content="noindex">/);
});

test("the auth service loads before the portal controller", () => {
  const html = read("src/app/features/portal/index.html");
  const auth = html.indexOf("/app/core/auth/auth.service.js");
  const portal = html.indexOf("/app/features/portal/portal.js");
  assert.notEqual(auth, -1);
  assert.notEqual(portal, -1);
  assert.ok(auth < portal, "auth.service.js debe cargarse antes que portal.js");
});

test("the portal gates on an existing session", () => {
  const js = read("src/app/features/portal/portal.js");
  assert.match(js, /requerirSesion/);
});

test("the portal never reports failures through the global operation channel", () => {
  /*
    reportarFallo emite taudux:operation-error, que navbar.js convierte en un
    toast genérico; sumado a mostrarToast darían dos avisos por un mismo fallo.
  */
  const js = read("src/app/features/portal/portal.js");
  assert.doesNotMatch(js, /reportarFallo/);
});

test("the navbar enables the portal link and points it at the portal page", () => {
  const js = read("src/app/shared/navbar/navbar.js");
  assert.match(
    js,
    /\{\s*texto:\s*"Portal",\s*href:\s*"\/app\/features\/portal\/",\s*habilitado:\s*true\s*\}/
  );
});

test("perfil.service.js and portal.perfil.js load before portal.js, and after auth.service.js", () => {
  const html = read("src/app/features/portal/index.html");
  const auth = html.indexOf("/app/core/auth/auth.service.js");
  const servicio = html.indexOf("/app/core/perfil/perfil.service.js");
  const nucleo = html.indexOf("/app/features/portal/portal.perfil.js");
  const portal = html.indexOf("/app/features/portal/portal.js");

  [auth, servicio, nucleo, portal].forEach((indice) => assert.notEqual(indice, -1));
  assert.ok(auth < servicio, "perfil.service.js debe cargarse después de auth.service.js");
  assert.ok(servicio < portal, "perfil.service.js debe cargarse antes que portal.js");
  assert.ok(nucleo < portal, "portal.perfil.js debe cargarse antes que portal.js");
});

test("the portal stylesheet treats --border-subtle as the full shorthand it is", () => {
  const css = read("src/app/features/portal/portal.css");
  assert.doesNotMatch(css, /1px solid var\(--border-subtle\)/);
});

test("the portal layout collapses to one column only on mobile", () => {
  const css = read("src/app/features/portal/portal.css");
  assert.match(css, /\.portal__layout\s*{[^}]*grid-template-columns:\s*minmax\(220px,\s*260px\)/);
  assert.match(
    css,
    /@media\s*\(max-width:\s*760px\)[\s\S]*?\.portal__layout\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/
  );
  assert.doesNotMatch(
    css.split(/@media\s*\(max-width:\s*760px\)/)[0],
    /\.portal__layout\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/
  );
});

test("the portal section markup matches the declared section catalog", () => {
  const html = read("src/app/features/portal/index.html");
  SECCIONES_PORTAL.forEach((seccion) => {
    assert.match(html, new RegExp(`id="seccion-${seccion.id}"`), `falta la sección ${seccion.id}`);
    assert.match(html, new RegExp(`href="#${seccion.id}"`), `falta el enlace a ${seccion.id}`);
  });
});

/* Bloque C-bis — la decisión de producto: las secciones "Pronto" no simulan trabajar. */

function markupSeccion(html, id) {
  const inicio = html.indexOf(`id="seccion-${id}"`);
  assert.notEqual(inicio, -1, `no se encontró la sección ${id}`);
  const fin = html.indexOf("</section>", inicio);
  assert.notEqual(fin, -1, `la sección ${id} no cierra`);
  return html.slice(inicio, fin);
}

/* Bloque D — sección "Mi cuenta". */

test("the account section re-authenticates before changing the password", () => {
  /*
    No hay harness funcional para signInWithPassword contra un cliente real de
    Supabase en estos tests (sin red, sin mocks del SDK); en su lugar, un
    contrato por regex sobre el orden textual, al estilo de los tests de orden
    de <script> ya existentes, deja constancia de que la re-autenticación
    ocurre antes que el cambio de contraseña sin necesitar ese harness.
  */
  const js = read("src/app/features/portal/portal.js");
  const reauth = js.indexOf("signInWithPassword");
  const cambio = js.indexOf("cambiarContrasena(nueva)");
  assert.notEqual(reauth, -1, "falta la re-autenticación");
  assert.notEqual(cambio, -1, "falta la llamada a cambiarContrasena");
  assert.ok(reauth < cambio, "signInWithPassword debe ejecutarse antes que cambiarContrasena");
});

test("the account email field is read-only and there is no role input", () => {
  const html = read("src/app/features/portal/index.html");
  const markup = markupSeccion(html, "cuenta");
  assert.match(markup, /id="cuentaEmail"[^>]*\breadonly\b/, "el correo debe ser readonly");
  assert.doesNotMatch(markup, /name="rol"/, "no debe existir un campo editable de rol");
});

test("unavailable portal sections ship no interactive controls at all", () => {
  /*
    Un input o un botón en una sección que todavía no hace nada promete una
    capacidad inexistente. Estas dos secciones solo explican qué falta.
    "correo" salió de esta lista: ya tiene backend real (ver bloque E).
  */
  const html = read("src/app/features/portal/index.html");
  ["plan", "pagos"].forEach((id) => {
    const markup = markupSeccion(html, id);
    assert.doesNotMatch(markup, /<input/i, `${id} no debe tener inputs`);
    assert.doesNotMatch(markup, /<select/i, `${id} no debe tener selects`);
    assert.doesNotMatch(markup, /<textarea/i, `${id} no debe tener textareas`);
    assert.doesNotMatch(markup, /<button/i, `${id} no debe tener botones`);
    assert.match(markup, /coming-soon__description/, `${id} debe explicar qué falta`);
  });
});

/* Bloque E — sección "Preferencias de correo". */

test("the email preference section is now declared available", () => {
  const correo = SECCIONES_PORTAL.find((seccion) => seccion.id === "correo");
  assert.equal(correo.disponible, true);
});

test("the email preference section ships exactly one checkbox, an alert region, and a submit button", () => {
  const html = read("src/app/features/portal/index.html");
  const markup = markupSeccion(html, "correo");

  const inputs = markup.match(/<input/gi) || [];
  assert.equal(inputs.length, 1, "la sección de correo debe tener un solo input");
  assert.match(markup, /<input[^>]*type="checkbox"[^>]*id="correoCursoNuevo"/);
  assert.match(markup, /id="correoStatus"[^>]*role="alert"/);
  assert.match(markup, /<button[^>]*type="submit"/);
  assert.doesNotMatch(markup, /coming-soon__description/, "ya no es un placeholder");
});

test("the correo nav link no longer carries the coming-soon badge", () => {
  const html = read("src/app/features/portal/index.html");
  const inicio = html.indexOf('href="#correo"');
  assert.notEqual(inicio, -1);
  const fin = html.indexOf("</a>", inicio);
  const enlace = html.slice(inicio, fin);
  assert.doesNotMatch(enlace, /portal__nav-badge/);
});

test("portal.correo.js loads after portal.perfil.js and before portal.js", () => {
  const html = read("src/app/features/portal/index.html");
  const perfilNucleo = html.indexOf("/app/features/portal/portal.perfil.js");
  const correoNucleo = html.indexOf("/app/features/portal/portal.correo.js");
  const portal = html.indexOf("/app/features/portal/portal.js");

  [perfilNucleo, correoNucleo, portal].forEach((indice) => assert.notEqual(indice, -1));
  assert.ok(perfilNucleo < correoNucleo, "portal.correo.js debe cargarse después de portal.perfil.js");
  assert.ok(correoNucleo < portal, "portal.correo.js debe cargarse antes que portal.js");
});

test("auth.service.js and perfil.service.js select avisos_curso_nuevo, or the checkbox would always render unchecked", () => {
  const authJs = read("src/app/core/auth/auth.service.js");
  const perfilServicio = read("src/app/core/perfil/perfil.service.js");
  assert.match(authJs, /\.select\(\s*"[^"]*avisos_curso_nuevo[^"]*"\s*\)/);
  assert.match(perfilServicio, /\.select\(\s*"[^"]*avisos_curso_nuevo[^"]*"\s*\)/);
});

test("portal.js converts the DB's snake_case avisos_curso_nuevo into the checkbox's camelCase field", () => {
  /*
    Bug real encontrado probando en el navegador: la BD devuelve
    avisos_curso_nuevo, pero normalizarPreferenciasCorreo espera
    avisosCursoNuevo. Sin esta conversión el checkbox nace siempre
    desmarcado sin importar el valor real guardado.
  */
  const js = read("src/app/features/portal/portal.js");
  assert.match(js, /avisosCursoNuevo:\s*perfil\s*&&\s*perfil\.avisos_curso_nuevo/);
});

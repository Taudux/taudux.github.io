const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

/*
  Precarga del formulario de contacto para un usuario logueado. "Empresa" no
  se prueba acá porque nunca se toca: no hay columna `empresa` en `perfiles`
  (ver el comentario en home.js), así que ese campo no tiene de dónde salir.
*/

function crearFormulario(valoresIniciales = {}) {
  return {
    elements: {
      nombre: { value: valoresIniciales.nombre || "" },
      email: { value: valoresIniciales.email || "" },
      telefono: { value: valoresIniciales.telefono || "" },
    },
  };
}

function crearContexto({ obtenerSesion, obtenerPerfil }) {
  const context = {
    console,
    document: {
      querySelector: () => null,
      addEventListener: () => {},
    },
    window: { addEventListener: () => {} },
    obtenerSesion,
    obtenerPerfil,
  };
  // home.js no expone sus funciones a propósito (es la página de entrada, no
  // un módulo compartido); se las pide acá igual que navbar.js lo hace en sus
  // propias pruebas, con un alias añadido al final del código fuente.
  vm.runInNewContext(
    `${read("src/app/features/home/home.js")}\nthis.precargarFormularioContacto = precargarFormularioContacto;`,
    context
  );
  return context;
}

test("with no session, the form is left exactly as the user typed it", async () => {
  const formulario = crearFormulario({ nombre: "Alguien ya escribió esto" });
  const context = crearContexto({
    obtenerSesion: async () => null,
    obtenerPerfil: async () => { throw new Error("no debería consultarse sin sesión"); },
  });

  await context.precargarFormularioContacto(formulario);

  assert.equal(formulario.elements.nombre.value, "Alguien ya escribió esto");
  assert.equal(formulario.elements.email.value, "");
  assert.equal(formulario.elements.telefono.value, "");
});

test("with a full session and profile, nombre, email, and telefono fill in — empresa is never touched", async () => {
  const formulario = crearFormulario();
  const context = crearContexto({
    obtenerSesion: async () => ({ user: { id: "u1", email: "persona@example.com" } }),
    obtenerPerfil: async () => ({ nombre: "Ana", apellidos: "Torres", telefono: "+524461234567" }),
  });

  await context.precargarFormularioContacto(formulario);

  assert.equal(formulario.elements.nombre.value, "Ana Torres");
  assert.equal(formulario.elements.email.value, "persona@example.com");
  assert.equal(formulario.elements.telefono.value, "+524461234567");
  assert.equal(formulario.elements.empresa, undefined, "el formulario real no tiene columna que respalde este campo");
});

test("a profile with only nombre (no apellidos) fills in without a trailing space", async () => {
  const formulario = crearFormulario();
  const context = crearContexto({
    obtenerSesion: async () => ({ user: { id: "u1", email: "solo@example.com" } }),
    obtenerPerfil: async () => ({ nombre: "Ana", apellidos: "", telefono: null }),
  });

  await context.precargarFormularioContacto(formulario);

  assert.equal(formulario.elements.nombre.value, "Ana");
  assert.equal(formulario.elements.telefono.value, "");
});

test("a session without a readable profile still fills the email — that one comes from auth, not perfiles", async () => {
  const formulario = crearFormulario();
  const context = crearContexto({
    obtenerSesion: async () => ({ user: { id: "u1", email: "sinperfil@example.com" } }),
    obtenerPerfil: async () => null,
  });

  await context.precargarFormularioContacto(formulario);

  assert.equal(formulario.elements.email.value, "sinperfil@example.com");
  assert.equal(formulario.elements.nombre.value, "");
});

test("fields the user already filled in are never overwritten, even with a full profile available", async () => {
  const formulario = crearFormulario({ nombre: "Nombre Propio", email: "propio@example.com", telefono: "0000000000" });
  const context = crearContexto({
    obtenerSesion: async () => ({ user: { id: "u1", email: "perfil@example.com" } }),
    obtenerPerfil: async () => ({ nombre: "Otro", apellidos: "Nombre", telefono: "+521111111111" }),
  });

  await context.precargarFormularioContacto(formulario);

  assert.equal(formulario.elements.nombre.value, "Nombre Propio");
  assert.equal(formulario.elements.email.value, "propio@example.com");
  assert.equal(formulario.elements.telefono.value, "0000000000");
});

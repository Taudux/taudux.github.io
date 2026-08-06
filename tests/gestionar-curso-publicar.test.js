const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

/*
  mensajePublicacionCurso decide el texto del diálogo de confirmación simple
  que gestionar-curso.js abre antes de publicar (migración 0018: publicar
  siempre reencola el aviso, incluso si el curso ya fue anunciado; migración
  0026: ese aviso es solo push, ya no correo).
  El resto de enviarFormulario vive detrás de un DOM real y no tiene harness
  de pruebas en este repo (ver el guard `module.exports` al tope del archivo);
  esta función sí se exporta explícitamente para poder testear su lógica sin
  Supabase ni DOM.
*/
const { mensajePublicacionCurso } = require(path.resolve("src/app/features/courses/gestionar-curso.js"));

const CURSO_ID = "123e4567-e89b-42d3-a456-426614174000";

test("a brand new course (no id) gets the first-time wording without querying the RPC", async () => {
  let llamadas = 0;
  const mensaje = await mensajePublicacionCurso(null, async () => { llamadas += 1; return { ok: true, data: true }; });

  assert.equal(llamadas, 0, "un curso nuevo nunca fue anunciado; no hace falta consultar");
  assert.match(mensaje, /Se enviará una notificación push/);
  assert.doesNotMatch(mensaje, /correo/i);
  assert.doesNotMatch(mensaje, /10 minutos/);
});

test("an existing course never announced before gets the first-time wording", async () => {
  const mensaje = await mensajePublicacionCurso(CURSO_ID, async () => ({ ok: true, data: false }));
  assert.match(mensaje, /Se enviará una notificación push/);
  assert.doesNotMatch(mensaje, /correo/i);
  assert.doesNotMatch(mensaje, /10 minutos/);
});

test("an existing course already announced gets the resend wording, not the first-time one", async () => {
  const mensaje = await mensajePublicacionCurso(CURSO_ID, async () => ({ ok: true, data: true }));
  assert.match(mensaje, /ya fue anunciado antes/);
  assert.match(mensaje, /todos los suscritos/);
  assert.doesNotMatch(mensaje, /correo/i);
});

test("a failed RPC (ok: false) falls back to the conservative wording", async () => {
  const mensaje = await mensajePublicacionCurso(CURSO_ID, async () => ({ ok: false }));
  assert.match(mensaje, /No pudimos verificar/);
  assert.doesNotMatch(mensaje, /correo/i);
});

test("a thrown RPC call also falls back to the conservative wording, never blocking", async () => {
  const mensaje = await mensajePublicacionCurso(CURSO_ID, async () => { throw new Error("network down"); });
  assert.match(mensaje, /No pudimos verificar/);
  assert.doesNotMatch(mensaje, /correo/i);
});

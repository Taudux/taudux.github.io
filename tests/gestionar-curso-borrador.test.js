const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  VERSION_BORRADOR,
  claveBorrador,
  serializarBorrador,
  leerBorrador,
  crearGuardaSalida,
  crearBorradorCurso,
} = require(path.resolve("src/app/features/courses/gestionar-curso.borrador.js"));

// Minimal fake sessionStorage: a Map is enough surface for get/set/removeItem.
function fakeStorage() {
  const datos = new Map();
  return {
    getItem: (clave) => (datos.has(clave) ? datos.get(clave) : null),
    setItem: (clave, valor) => { datos.set(clave, valor); },
    removeItem: (clave) => { datos.delete(clave); },
    size: () => datos.size,
  };
}

// Minimal fake window: event listeners plus timers, both synchronous where the
// tests need to force them (fireBeforeUnload / fireCambio).
function fakeVentana() {
  const listeners = {};
  let temporizadorId = 0;
  const temporizadores = new Map();
  return {
    addEventListener(tipo, fn) {
      listeners[tipo] = listeners[tipo] || [];
      listeners[tipo].push(fn);
    },
    removeEventListener(tipo, fn) {
      listeners[tipo] = (listeners[tipo] || []).filter((f) => f !== fn);
    },
    setTimeout(fn) {
      const id = ++temporizadorId;
      temporizadores.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      temporizadores.delete(id);
    },
    dispararTimers() {
      const pendientes = [...temporizadores.values()];
      temporizadores.clear();
      pendientes.forEach((fn) => fn());
    },
    disparar(tipo, evento = {}) {
      (listeners[tipo] || []).forEach((fn) => fn(evento));
    },
    listenersDe(tipo) {
      return (listeners[tipo] || []).length;
    },
  };
}

test("claveBorrador separa crear de editar", () => {
  assert.equal(claveBorrador(null), "taudux:borrador:curso:new");
  assert.equal(claveBorrador(undefined), "taudux:borrador:curso:new");
  assert.equal(
    claveBorrador("11111111-1111-1111-1111-111111111111"),
    "taudux:borrador:curso:11111111-1111-1111-1111-111111111111"
  );
});

test("round-trip: lo que serializarBorrador escribe, leerBorrador lo recupera igual", () => {
  const datos = { titulo: "Curso", categoria_id: "id-ia" };
  const crudo = serializarBorrador(datos, 1000);
  assert.deepEqual(leerBorrador(crudo, 1000), datos);
});

test("leerBorrador descarta JSON corrupto sin lanzar", () => {
  assert.equal(leerBorrador("{no es json", 1000), null);
});

test("leerBorrador descarta un esquema de otra versión", () => {
  const crudo = JSON.stringify({ v: VERSION_BORRADOR + 1, guardadoEn: 1000, datos: { titulo: "x" } });
  assert.equal(leerBorrador(crudo, 1000), null);
});

test("leerBorrador descarta un borrador vencido", () => {
  const crudo = serializarBorrador({ titulo: "x" }, 0);
  const veinticincoHoras = 25 * 60 * 60 * 1000;
  assert.equal(leerBorrador(crudo, veinticincoHoras), null);
});

test("leerBorrador acepta un borrador dentro de la vigencia", () => {
  const crudo = serializarBorrador({ titulo: "x" }, 0);
  const veintitresHoras = 23 * 60 * 60 * 1000;
  assert.deepEqual(leerBorrador(crudo, veintitresHoras), { titulo: "x" });
});

test("leerBorrador rechaza entradas vacías o sin forma de sobre", () => {
  assert.equal(leerBorrador(null, 1000), null);
  assert.equal(leerBorrador("", 1000), null);
  assert.equal(leerBorrador(JSON.stringify({ v: VERSION_BORRADOR }), 1000), null);
  assert.equal(leerBorrador(JSON.stringify({ v: VERSION_BORRADOR, guardadoEn: 1000, datos: "no-objeto" }), 1000), null);
});

test("crearGuardaSalida: formulario limpio nunca avisa", () => {
  const guarda = crearGuardaSalida({
    estaSucio: () => false,
    estaEnviando: () => false,
    ventana: fakeVentana(),
  });
  assert.equal(guarda.debeAvisar(), false);
});

test("crearGuardaSalida: sucio y no enviando avisa", () => {
  const guarda = crearGuardaSalida({
    estaSucio: () => true,
    estaEnviando: () => false,
    ventana: fakeVentana(),
  });
  assert.equal(guarda.debeAvisar(), true);
});

test("crearGuardaSalida: sucio mientras se envía no avisa", () => {
  const guarda = crearGuardaSalida({
    estaSucio: () => true,
    estaEnviando: () => true,
    ventana: fakeVentana(),
  });
  assert.equal(guarda.debeAvisar(), false);
});

test("crearGuardaSalida: solo registra el listener de beforeunload mientras hace falta", () => {
  let sucio = false;
  const ventana = fakeVentana();
  const guarda = crearGuardaSalida({
    estaSucio: () => sucio,
    estaEnviando: () => false,
    ventana,
  });

  guarda.sincronizar();
  assert.equal(ventana.listenersDe("beforeunload"), 0);

  sucio = true;
  guarda.sincronizar();
  assert.equal(ventana.listenersDe("beforeunload"), 1);

  sucio = false;
  guarda.sincronizar();
  assert.equal(ventana.listenersDe("beforeunload"), 0);
});

test("crearGuardaSalida: previene la salida cuando el evento se dispara sucio", () => {
  const ventana = fakeVentana();
  const guarda = crearGuardaSalida({
    estaSucio: () => true,
    estaEnviando: () => false,
    ventana,
  });
  guarda.sincronizar();

  const evento = { preventDefault: () => { evento.prevenido = true; }, returnValue: undefined };
  ventana.disparar("beforeunload", evento);
  assert.equal(evento.prevenido, true);
});

test("crearBorradorCurso: guarda tras el debounce solo si está sucio", () => {
  const storage = fakeStorage();
  const ventana = fakeVentana();
  let sucio = true;
  const borrador = crearBorradorCurso({
    obtenerCursoId: () => null,
    obtenerDatos: () => ({ titulo: "Nuevo curso" }),
    estaSucio: () => sucio,
    estaEnviando: () => false,
    almacenamiento: storage,
    ventana,
    ahora: () => 5000,
  });

  borrador.marcarListo();
  borrador.registrarCambio();
  ventana.dispararTimers();

  assert.equal(storage.size(), 1);
  assert.deepEqual(borrador.recuperar(), { titulo: "Nuevo curso" });
});

test("crearBorradorCurso: crear y editar no comparten clave", () => {
  const storage = fakeStorage();
  const ventana = fakeVentana();
  let cursoId = null;
  const borrador = crearBorradorCurso({
    obtenerCursoId: () => cursoId,
    obtenerDatos: () => ({ titulo: "Creando" }),
    estaSucio: () => true,
    estaEnviando: () => false,
    almacenamiento: storage,
    ventana,
    ahora: () => 0,
  });

  borrador.marcarListo();
  borrador.registrarCambio();
  ventana.dispararTimers();
  assert.deepEqual(borrador.recuperar(), { titulo: "Creando" });

  cursoId = "curso-1";
  assert.equal(borrador.recuperar(), null);
});

test("crearBorradorCurso: pagehide persiste de inmediato sin esperar el debounce", () => {
  const storage = fakeStorage();
  const ventana = fakeVentana();
  const borrador = crearBorradorCurso({
    obtenerCursoId: () => null,
    obtenerDatos: () => ({ titulo: "Sin guardar" }),
    estaSucio: () => true,
    estaEnviando: () => false,
    almacenamiento: storage,
    ventana,
    ahora: () => 0,
  });

  borrador.marcarListo();
  borrador.registrarCambio();
  ventana.disparar("pagehide");

  assert.deepEqual(borrador.recuperar(), { titulo: "Sin guardar" });
});

test("crearBorradorCurso: un pagehide antes de marcarListo no toca un borrador previo", () => {
  const storage = fakeStorage();
  storage.setItem(claveBorrador(null), serializarBorrador({ titulo: "Borrador previo" }, 0));
  const ventana = fakeVentana();
  const borrador = crearBorradorCurso({
    obtenerCursoId: () => null,
    obtenerDatos: () => ({ titulo: "Borrador previo" }),
    // huellaBase todavía no existe en el controlador real: se refleja como
    // "no sucio" hasta que se establece, que es justo el caso peligroso.
    estaSucio: () => false,
    estaEnviando: () => false,
    almacenamiento: storage,
    ventana,
    ahora: () => 0,
  });

  ventana.disparar("pagehide");

  assert.equal(storage.size(), 1);
  assert.deepEqual(borrador.recuperar(), { titulo: "Borrador previo" });
});

test("crearBorradorCurso: tras marcarListo, un formulario limpio sí borra un borrador obsoleto", () => {
  const storage = fakeStorage();
  storage.setItem(claveBorrador(null), serializarBorrador({ titulo: "Obsoleto" }, 0));
  const ventana = fakeVentana();
  const borrador = crearBorradorCurso({
    obtenerCursoId: () => null,
    obtenerDatos: () => ({ titulo: "Obsoleto" }),
    estaSucio: () => false,
    estaEnviando: () => false,
    almacenamiento: storage,
    ventana,
    ahora: () => 0,
  });

  borrador.marcarListo();
  ventana.disparar("pagehide");

  assert.equal(storage.size(), 0);
});

test("crearBorradorCurso: descartar borra el borrador guardado", () => {
  const storage = fakeStorage();
  const ventana = fakeVentana();
  const borrador = crearBorradorCurso({
    obtenerCursoId: () => null,
    obtenerDatos: () => ({ titulo: "x" }),
    estaSucio: () => true,
    estaEnviando: () => false,
    almacenamiento: storage,
    ventana,
    ahora: () => 0,
  });

  borrador.marcarListo();
  borrador.registrarCambio();
  ventana.dispararTimers();
  assert.equal(storage.size(), 1);

  borrador.descartar();
  assert.equal(storage.size(), 0);
  assert.equal(borrador.recuperar(), null);
});

test("crearBorradorCurso: abandonar desarma el guard y deja de guardar futuros cambios", () => {
  const storage = fakeStorage();
  const ventana = fakeVentana();
  const borrador = crearBorradorCurso({
    obtenerCursoId: () => null,
    obtenerDatos: () => ({ titulo: "x" }),
    estaSucio: () => true,
    estaEnviando: () => false,
    almacenamiento: storage,
    ventana,
    ahora: () => 0,
  });

  borrador.registrarCambio();
  assert.equal(ventana.listenersDe("beforeunload"), 1);

  borrador.abandonar();
  assert.equal(storage.size(), 0);
  assert.equal(ventana.listenersDe("beforeunload"), 0);

  // Un pagehide posterior a abandonar (p. ej. la navegación de éxito) no debe
  // resucitar el borrador que ya se descartó.
  ventana.disparar("pagehide");
  assert.equal(storage.size(), 0);
});

test("crearBorradorCurso: se degrada sin lanzar cuando no hay almacenamiento disponible", () => {
  const ventana = fakeVentana();
  const borrador = crearBorradorCurso({
    obtenerCursoId: () => null,
    obtenerDatos: () => ({ titulo: "x" }),
    estaSucio: () => true,
    estaEnviando: () => false,
    almacenamiento: null,
    ventana,
    ahora: () => 0,
  });

  assert.doesNotThrow(() => {
    borrador.registrarCambio();
    ventana.dispararTimers();
  });
  assert.equal(borrador.recuperar(), null);
});

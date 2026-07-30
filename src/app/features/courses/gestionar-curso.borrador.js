/*
  Borrador local del formulario de curso. Dos capas contra la pérdida silenciosa
  del progreso: un aviso nativo al salir (`beforeunload`) y una copia del
  formulario que se ofrece restaurar al volver.

  El borrador vive en sessionStorage, no en localStorage. El caso real es
  Alt + ← en la misma pestaña —que sessionStorage sí sobrevive, porque los
  navegadores lo restauran en back/forward— y así el progreso no queda en disco
  al cerrar la pestaña, en línea con la decisión de supabase-client.js de mover
  la sesión a sessionStorage.

  Crear y editar usan claves distintas: un borrador nunca se filtra al otro modo.
  La portada no viaja en el borrador porque un File no es serializable.

  Todo lo externo (almacenamiento, ventana, reloj) llega por parámetro, así que
  el módulo se prueba sin DOM. El cableado vive en gestionar-curso.js.
*/

const VERSION_BORRADOR = 1;
const PREFIJO_BORRADOR = "taudux:borrador:curso:";
const CLAVE_BORRADOR_NUEVO = "new";
const VIGENCIA_BORRADOR_MS = 24 * 60 * 60 * 1000;
const RETARDO_GUARDADO_BORRADOR_MS = 400;

function claveBorrador(cursoId) {
  return `${PREFIJO_BORRADOR}${cursoId || CLAVE_BORRADOR_NUEVO}`;
}

function serializarBorrador(datos, ahora) {
  return JSON.stringify({ v: VERSION_BORRADOR, guardadoEn: ahora, datos });
}

/*
  Nunca lanza: un borrador ilegible es un borrador que no existe. Descarta JSON
  corrupto, esquemas de otra versión y borradores vencidos, porque restaurar
  cualquiera de esos casos sería peor que no ofrecer nada.
*/
function leerBorrador(crudo, ahora) {
  if (typeof crudo !== "string" || crudo === "") return null;
  let sobre;
  try {
    sobre = JSON.parse(crudo);
  } catch {
    return null;
  }
  if (!sobre || typeof sobre !== "object") return null;
  if (sobre.v !== VERSION_BORRADOR) return null;
  if (!Number.isFinite(sobre.guardadoEn)) return null;
  if (ahora - sobre.guardadoEn > VIGENCIA_BORRADOR_MS) return null;
  if (!sobre.datos || typeof sobre.datos !== "object") return null;
  return sobre.datos;
}

/*
  Un listener de `beforeunload` registrado deshabilita el bfcache en varios
  navegadores, así que solo se mantiene mientras haga falta: se da de alta
  cuando el formulario se ensucia y de baja cuando vuelve a estar limpio.
  Durante el envío no se avisa; ahí el usuario no está abandonando nada.
*/
function crearGuardaSalida({ estaSucio, estaEnviando, ventana }) {
  let registrada = false;

  function debeAvisar() {
    if (estaEnviando()) return false;
    return estaSucio();
  }

  function alSalir(evento) {
    if (!debeAvisar()) return;
    evento.preventDefault();
    evento.returnValue = "";
  }

  function sincronizar() {
    const necesaria = debeAvisar();
    if (necesaria === registrada) return registrada;
    if (necesaria) ventana.addEventListener("beforeunload", alSalir);
    else ventana.removeEventListener("beforeunload", alSalir);
    registrada = necesaria;
    return registrada;
  }

  function desarmar() {
    if (!registrada) return;
    ventana.removeEventListener("beforeunload", alSalir);
    registrada = false;
  }

  return Object.freeze({ debeAvisar, sincronizar, desarmar, estaRegistrada: () => registrada });
}

// El acceso a sessionStorage vive acá adentro —y no en el controlador del
// formulario— para que el contrato estático de gestionar-curso.js pueda seguir
// prohibiendo el acceso directo a almacenamiento del navegador en ese archivo.
function almacenamientoSesion(ventana) {
  try {
    return ventana.sessionStorage || null;
  } catch {
    return null;
  }
}

function crearBorradorCurso({
  obtenerCursoId,
  obtenerDatos,
  estaSucio,
  estaEnviando,
  ventana,
  almacenamiento = almacenamientoSesion(ventana),
  ahora = () => Date.now(),
  retardo = RETARDO_GUARDADO_BORRADOR_MS,
}) {
  const guarda = crearGuardaSalida({ estaSucio, estaEnviando, ventana });
  let temporizador = null;
  let activo = true;
  /*
    El controlador tarda en establecer su línea base (espera admin, categorías,
    poblado inicial): hasta entonces `estaSucio()` no tiene forma de distinguir
    "todavía no sé" de "está limpio". Si un pagehide llegara en esa ventana,
    `guardarAhora` leería "limpio" y borraría un borrador previo que el usuario
    ni llegó a ver ofrecido para restaurar. `listo` cierra esa ventana: hasta que
    el controlador llama a `marcarListo()`, ni se guarda ni se borra nada.
  */
  let listo = false;

  // El modo privado y la cuota agotada lanzan al tocar el almacenamiento. Ahí el
  // borrador se degrada a la capa de aviso en vez de romper el formulario.
  function conAlmacenamiento(accion) {
    if (!almacenamiento) return null;
    try {
      return accion(almacenamiento);
    } catch {
      return null;
    }
  }

  function cancelarPendiente() {
    if (temporizador === null) return;
    ventana.clearTimeout(temporizador);
    temporizador = null;
  }

  function olvidar() {
    conAlmacenamiento((deposito) => deposito.removeItem(claveBorrador(obtenerCursoId())));
  }

  function guardarAhora() {
    cancelarPendiente();
    if (!activo || !listo || estaEnviando()) return;
    if (!estaSucio()) {
      olvidar();
      return;
    }
    const sobre = serializarBorrador(obtenerDatos(), ahora());
    conAlmacenamiento((deposito) => deposito.setItem(claveBorrador(obtenerCursoId()), sobre));
  }

  // `pagehide` es el último punto fiable para persistir: cubre el cierre de
  // pestaña y el Alt + ← que ocurren antes de que venza el debounce.
  ventana.addEventListener("pagehide", guardarAhora);

  function descartar() {
    cancelarPendiente();
    olvidar();
  }

  return Object.freeze({
    recuperar() {
      const crudo = conAlmacenamiento((deposito) => deposito.getItem(claveBorrador(obtenerCursoId())));
      return leerBorrador(crudo, ahora());
    },

    // Cada cambio reajusta el aviso y reprograma el guardado; escribir en cada
    // pulsación sería gratuito de más para ~20 campos.
    registrarCambio() {
      if (!activo) return;
      guarda.sincronizar();
      cancelarPendiente();
      temporizador = ventana.setTimeout(guardarAhora, retardo);
    },

    // El controlador la llama una vez establecida la línea base (huellaBase),
    // recién ahí es seguro que un pagehide guarde o borre sin arriesgar un
    // borrador previo que el usuario todavía no vio ofrecido.
    marcarListo() {
      listo = true;
    },

    descartar,

    /*
      Salida deliberada (guardado con éxito, o Cancelar): además de borrar hay
      que apagar el módulo, o el `pagehide` de la navegación siguiente volvería
      a persistir el formulario que el usuario acaba de abandonar.
    */
    abandonar() {
      descartar();
      guarda.desarmar();
      activo = false;
    },

    debeAvisar: guarda.debeAvisar,
    guardaRegistrada: guarda.estaRegistrada,
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    VERSION_BORRADOR,
    PREFIJO_BORRADOR,
    VIGENCIA_BORRADOR_MS,
    claveBorrador,
    serializarBorrador,
    leerBorrador,
    crearGuardaSalida,
    crearBorradorCurso,
  });
}

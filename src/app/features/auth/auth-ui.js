/* Utilidades visuales compartidas por las páginas de autenticación. */

const CLAVE_EMAIL_CONFIRMACION = "taudux_auth_confirmation_email";

const REQUISITOS_CONTRASENA = Object.freeze({
  longitud: (password) => password.length >= 8,
  mayuscula: (password) => /[A-Z]/.test(password),
  minuscula: (password) => /[a-z]/.test(password),
  digito: (password) => /\d/.test(password),
});

function contrasenaValida(password) {
  return Object.values(REQUISITOS_CONTRASENA).every((validar) => validar(password));
}

function evaluarRequisitosContrasena(input, lista) {
  const password = input.value;
  lista.querySelectorAll(".password-requirements__item").forEach((item) => {
    const validar = REQUISITOS_CONTRASENA[item.dataset.req];
    const cumple = validar(password);
    item.classList.toggle("password-requirements__item--valid", password.length > 0 && cumple);
    item.classList.toggle("password-requirements__item--invalid", password.length > 0 && !cumple);
  });
}

function configurarRequisitosContrasena(input, lista) {
  if (!input || !lista) return;
  input.addEventListener("input", () => evaluarRequisitosContrasena(input, lista));
}

function estadoCoincidenciaContrasenas(original, copia) {
  if (!copia) return "neutral";
  if (original !== copia) return "mismatch";
  if (!contrasenaValida(original)) return "debil";
  return "ok";
}

function evaluarCoincidenciaContrasenas(input, confirmacion, aviso) {
  const estado = estadoCoincidenciaContrasenas(input.value, confirmacion.value);
  const marcaMatch = (campo, valor) => {
    if (valor) campo.setAttribute("data-match", valor);
    else campo.removeAttribute("data-match");
  };

  if (estado === "mismatch") {
    marcaMatch(input, "mismatch");
    marcaMatch(confirmacion, "mismatch");
  } else if (estado === "ok") {
    marcaMatch(input, "ok");
    marcaMatch(confirmacion, "ok");
  } else {
    marcaMatch(input, null);
    marcaMatch(confirmacion, null);
  }

  if (!aviso) return;
  const mensajes = {
    neutral: "",
    debil: "Coinciden, pero falta cumplir los requisitos.",
    mismatch: "Las contraseñas no coinciden.",
    ok: "Las contraseñas coinciden.",
  };
  aviso.textContent = mensajes[estado];
  aviso.classList.toggle("password-match--error", estado === "mismatch");
  aviso.classList.toggle("password-match--ok", estado === "ok");
}

function configurarCoincidenciaContrasenas(input, confirmacion, aviso) {
  if (!input || !confirmacion) return;
  const evaluar = () => evaluarCoincidenciaContrasenas(input, confirmacion, aviso);
  input.addEventListener("input", evaluar);
  confirmacion.addEventListener("input", evaluar);
}

function configurarTogglesContrasena() {
  document.querySelectorAll(".password-field__toggle").forEach((boton) => {
    const input = document.getElementById(boton.dataset.target);
    if (!input) return;

    boton.addEventListener("click", () => {
      const mostrando = input.type === "text";
      input.type = mostrando ? "password" : "text";
      boton.classList.toggle("password-field__toggle--showing", !mostrando);
      boton.setAttribute("aria-label", mostrando ? "Mostrar contraseña" : "Ocultar contraseña");
      boton.setAttribute("aria-pressed", String(!mostrando));
    });
  });
}

function limpiarErroresCamposAuth() {
  document.querySelectorAll("[data-auth-error-associated]").forEach((campo) => {
    campo.removeAttribute("aria-invalid");
    delete campo.dataset.authErrorAssociated;

    const descripciones = (campo.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((id) => id && id !== "authStatus");
    if (descripciones.length) {
      campo.setAttribute("aria-describedby", descripciones.join(" "));
    } else {
      campo.removeAttribute("aria-describedby");
    }
  });
}

function asociarErrorAuthACampos(campos) {
  campos.filter(Boolean).forEach((campo) => {
    const descripciones = new Set(
      (campo.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)
    );
    descripciones.add("authStatus");
    campo.setAttribute("aria-describedby", [...descripciones].join(" "));
    campo.setAttribute("aria-invalid", "true");
    campo.dataset.authErrorAssociated = "true";
  });
}

function mostrarEstadoAuth(mensaje, tipo = "info", enfocar = true, campos = []) {
  const estado = document.getElementById("authStatus");
  if (!estado) return;

  limpiarErroresCamposAuth();
  if (tipo === "error") asociarErrorAuthACampos(campos);
  estado.textContent = mensaje;
  estado.hidden = false;
  estado.classList.toggle("auth__status--error", tipo === "error");
  estado.classList.toggle("auth__status--success", tipo === "success");
  estado.setAttribute("role", tipo === "error" ? "alert" : "status");
  estado.setAttribute("aria-live", tipo === "error" ? "assertive" : "polite");
  if (enfocar) estado.focus();
}

function ocultarEstadoAuth() {
  const estado = document.getElementById("authStatus");
  if (!estado) return;
  estado.hidden = true;
  estado.textContent = "";
  estado.classList.remove("auth__status--error", "auth__status--success");
  limpiarErroresCamposAuth();
}

function establecerFormularioOcupado(formulario, ocupado) {
  formulario.dataset.enviando = String(ocupado);
  formulario.setAttribute("aria-busy", String(ocupado));

  formulario.querySelectorAll("button, input, select").forEach((control) => {
    if (ocupado) {
      control.dataset.estabaDeshabilitado = String(control.disabled);
      control.disabled = true;
    } else {
      control.disabled = control.dataset.estabaDeshabilitado === "true";
      delete control.dataset.estabaDeshabilitado;
    }
  });

  const boton = formulario.querySelector('button[type="submit"]');
  if (!boton) return;
  if (ocupado) {
    boton.dataset.textoOriginal = boton.textContent;
    boton.textContent = boton.dataset.loadingText || "Procesando…";
    boton.classList.add("auth__submit--loading");
  } else {
    boton.textContent = boton.dataset.textoOriginal || boton.textContent;
    delete boton.dataset.textoOriginal;
    boton.classList.remove("auth__submit--loading");
  }
}

function formularioEstaOcupado(formulario) {
  return formulario.dataset.enviando === "true";
}

function establecerBotonOcupado(boton, ocupado) {
  boton.disabled = ocupado;
  boton.setAttribute("aria-busy", String(ocupado));
}

/*
  pageshow con persisted:true es la señal de que la página volvió del
  bfcache (botón Atrás tras un redirect completo, ej. "Continuar con
  Google"): el navegador restaura el DOM tal cual quedó al salir, sin volver
  a correr este script. Un botón que establecerBotonOcupado dejó disabled
  porque se asumió "si esto sigue vivo es porque el redirect falló" (ver
  login.js/signup.js) queda inutilizable para siempre sin este reset.

  Recibe documento como parámetro (en vez de leer el global) para poder
  ejecutarse de verdad en los tests, sin necesitar un DOM real.
*/
function reactivarBotonesTrasBfcache(evento, documento) {
  if (!evento.persisted) return;
  documento.querySelectorAll('button[aria-busy="true"]').forEach((boton) => {
    establecerBotonOcupado(boton, false);
  });
}

function normalizarTelefonoE164(prefijo, numero) {
  const codigoPais = prefijo.replace(/\D/g, "");
  const numeroNacional = numero.replace(/\D/g, "");
  const digitos = `${codigoPais}${numeroNacional}`;
  if (!/^[1-9]\d{7,14}$/.test(digitos)) return null;
  return `+${digitos}`;
}

function limitarTelefonoNacional(input, prefijo) {
  const longitudPrefijo = prefijo.replace(/\D/g, "").length;
  const maximo = Math.max(1, 15 - longitudPrefijo);
  input.value = input.value.replace(/\D/g, "").slice(0, maximo);
}

function guardarEmailConfirmacion(email) {
  try {
    sessionStorage.setItem(CLAVE_EMAIL_CONFIRMACION, email);
  } catch {
    // La pantalla permite volver a escribir el correo si storage no está disponible.
  }
}

function obtenerEmailConfirmacion() {
  try {
    return sessionStorage.getItem(CLAVE_EMAIL_CONFIRMACION) || "";
  } catch {
    return "";
  }
}

function limpiarEmailConfirmacion() {
  try {
    sessionStorage.removeItem(CLAVE_EMAIL_CONFIRMACION);
  } catch {
    // No bloquea el cierre de la sesión temporal.
  }
}

function agregarDestinoAEnlaces() {
  const destino = obtenerDestinoAuth();
  if (!destino) return;

  document.querySelectorAll("[data-preserve-next]").forEach((enlace) => {
    const url = new URL(enlace.href, window.location.origin);
    url.searchParams.set("next", destino);
    enlace.href = `${url.pathname}${url.search}`;
  });
}

function parametrosErrorAuth() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const codigo = hash.get("error_code") || query.get("error_code");
  const descripcion = hash.get("error_description") || query.get("error_description");
  return codigo || descripcion ? { codigo, descripcion } : null;
}

function mensajeErrorEnlace(parametros) {
  const erroresExpirados = ["otp_expired", "flow_state_expired", "flow_state_not_found"];
  if (erroresExpirados.includes(parametros?.codigo)) {
    return "El enlace expiró o ya fue utilizado. Solicita uno nuevo.";
  }
  return "El enlace no es válido. Solicita uno nuevo.";
}

function destinoDespuesDeAuth() {
  return obtenerDestinoAuth() || "/";
}

async function redirigirSiSesionActiva() {
  const session = await obtenerSesion();
  if (!session) return false;
  window.location.replace(destinoDespuesDeAuth());
  return true;
}

if (typeof document !== "undefined") {
  configurarTogglesContrasena();
  agregarDestinoAEnlaces();

  document.querySelectorAll(".auth__form input, .auth__form select").forEach((campo) => {
    campo.addEventListener("input", () => {
      if (campo.dataset.authErrorAssociated) limpiarErroresCamposAuth();
    });
  });

  window.addEventListener("pageshow", (evento) => reactivarBotonesTrasBfcache(evento, document));
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    estadoCoincidenciaContrasenas,
    reactivarBotonesTrasBfcache,
  };
}

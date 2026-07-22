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

async function destinoDespuesDeAuth(session) {
  const destino = obtenerDestinoAuth();
  if (destino) return destino;
  return (await esAdmin(session))
    ? "/src/app/features/explore/explorar.html"
    : "/index.html";
}

async function redirigirSiSesionActiva() {
  const session = await obtenerSesion();
  if (!session) return false;
  window.location.replace(await destinoDespuesDeAuth(session));
  return true;
}

configurarTogglesContrasena();
agregarDestinoAEnlaces();

document.querySelectorAll(".auth__form input, .auth__form select").forEach((campo) => {
  campo.addEventListener("input", () => {
    if (campo.dataset.authErrorAssociated) limpiarErroresCamposAuth();
  });
});

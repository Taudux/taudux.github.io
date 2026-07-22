/* Inicio de sesión y reenvío de confirmación para cuentas no confirmadas. */

const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const reenviarButton = document.getElementById("reenviarButton");

const parametrosLogin = new URLSearchParams(window.location.search);
if (parametrosLogin.get("confirmed") === "1") {
  mostrarEstadoAuth("Correo confirmado. Ya puedes iniciar sesión.", "success", false);
} else if (parametrosLogin.get("password-reset") === "1") {
  mostrarEstadoAuth("Contraseña actualizada. Inicia sesión con tu nueva contraseña.", "success", false);
}

redirigirSiSesionActiva();

loginForm.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (formularioEstaOcupado(loginForm)) return;

  reenviarButton.hidden = true;
  ocultarEstadoAuth();
  if (!loginForm.checkValidity()) {
    loginForm.reportValidity();
    return;
  }

  establecerFormularioOcupado(loginForm, true);
  try {
    const resultado = await iniciarSesion(loginEmail.value.trim(), loginPassword.value);
    if (!resultado.ok) {
      mostrarEstadoAuth(resultado.mensaje, "error", true, [loginEmail, loginPassword]);
      reenviarButton.hidden = !resultado.noConfirmado;
      return;
    }

    const destino = await destinoDespuesDeAuth(resultado.data.session);
    limpiarDestinoAuth();
    window.location.replace(destino);
  } finally {
    establecerFormularioOcupado(loginForm, false);
  }
});

reenviarButton.addEventListener("click", async () => {
  if (formularioEstaOcupado(loginForm)) return;
  const email = loginEmail.value.trim();
  if (!email || !loginEmail.checkValidity()) {
    loginEmail.focus();
    mostrarEstadoAuth(
      "Escribe un correo válido para reenviar la confirmación.",
      "error",
      true,
      [loginEmail]
    );
    return;
  }

  establecerFormularioOcupado(loginForm, true);
  establecerBotonOcupado(reenviarButton, true);
  try {
    const resultado = await reenviarConfirmacion(email);
    mostrarEstadoAuth(
      resultado.ok
        ? "Si la cuenta está pendiente de confirmación, recibirás un nuevo correo."
        : resultado.mensaje,
      resultado.ok ? "success" : "error",
      true,
      resultado.ok ? [] : [loginEmail]
    );
  } finally {
    establecerBotonOcupado(reenviarButton, false);
    establecerFormularioOcupado(loginForm, false);
  }
});

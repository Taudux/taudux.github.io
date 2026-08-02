/* Registro de cuenta con confirmación de correo obligatoria. */

const signupForm = document.getElementById("signupForm");
const googleButton = document.getElementById("googleButton");
const signupPais = document.getElementById("signupPais");
const signupPrefijo = document.getElementById("signupPrefijo");
const signupTelefono = document.getElementById("signupTelefono");
const signupPassword = document.getElementById("signupPassword");
const signupPasswordConfirm = document.getElementById("signupPasswordConfirm");
const passwordReqs = document.getElementById("passwordReqs");

configurarRequisitosContrasena(signupPassword, passwordReqs);
configurarCoincidenciaContrasenas(signupPassword, signupPasswordConfirm, document.getElementById("signupPasswordMatch"));
redirigirSiSesionActiva();

signupPais.addEventListener("change", () => {
  signupPrefijo.textContent = signupPais.value;
  limitarTelefonoNacional(signupTelefono, signupPais.value);
});

signupTelefono.addEventListener("input", () => {
  limitarTelefonoNacional(signupTelefono, signupPais.value);
});

googleButton.addEventListener("click", async () => {
  if (formularioEstaOcupado(signupForm)) return;
  ocultarEstadoAuth();
  establecerBotonOcupado(googleButton, true);
  const resultado = await iniciarSesionConGoogle();
  // En el camino feliz el navegador ya se fue a Google; solo se llega acá si falló.
  if (!resultado.ok) {
    establecerBotonOcupado(googleButton, false);
    mostrarEstadoAuth(resultado.mensaje, "error");
  }
});

signupForm.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (formularioEstaOcupado(signupForm)) return;
  ocultarEstadoAuth();

  if (!signupForm.checkValidity()) {
    signupForm.reportValidity();
    return;
  }

  if (!contrasenaValida(signupPassword.value)) {
    signupPassword.focus();
    mostrarEstadoAuth(
      "La contraseña no cumple los requisitos de seguridad.",
      "error",
      true,
      [signupPassword]
    );
    return;
  }

  if (signupPassword.value !== signupPasswordConfirm.value) {
    signupPasswordConfirm.focus();
    mostrarEstadoAuth("Las contraseñas no coinciden.", "error", true, [signupPasswordConfirm]);
    return;
  }

  const telefono = normalizarTelefonoE164(signupPais.value, signupTelefono.value);
  if (!telefono) {
    signupTelefono.focus();
    mostrarEstadoAuth(
      "Ingresa un teléfono válido con código de país.",
      "error",
      true,
      [signupTelefono]
    );
    return;
  }

  const email = document.getElementById("signupEmail").value.trim();
  establecerFormularioOcupado(signupForm, true);
  try {
    const resultado = await registrarUsuario(
      email,
      signupPassword.value,
      document.getElementById("signupName").value.trim(),
      document.getElementById("signupApellidos").value.trim(),
      telefono
    );
    if (!resultado.ok) {
      mostrarEstadoAuth(
        resultado.mensaje,
        "error",
        true,
        [document.getElementById("signupEmail")]
      );
      return;
    }

    guardarEmailConfirmacion(email);
    obtenerDestinoAuth();
    window.location.replace(RUTAS_AUTH.confirm);
  } finally {
    establecerFormularioOcupado(signupForm, false);
  }
});

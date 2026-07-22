/* Solicitud neutral de recuperación para no revelar si una cuenta existe. */

const forgotForm = document.getElementById("forgotForm");
const forgotEmail = document.getElementById("forgotEmail");

redirigirSiSesionActiva();

forgotForm.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (formularioEstaOcupado(forgotForm)) return;
  ocultarEstadoAuth();

  if (!forgotForm.checkValidity()) {
    forgotForm.reportValidity();
    return;
  }

  establecerFormularioOcupado(forgotForm, true);
  try {
    const resultado = await recuperarContrasena(forgotEmail.value.trim());
    mostrarEstadoAuth(
      resultado.ok
        ? "Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña."
        : resultado.mensaje,
      resultado.ok ? "success" : "error",
      true,
      resultado.ok ? [] : [forgotEmail]
    );
  } finally {
    establecerFormularioOcupado(forgotForm, false);
  }
});

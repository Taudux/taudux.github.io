/* Protege el hub privado y completa su encabezado con la sesión activa. */

(async () => {
  const session = await requerirSesion();
  if (!session) return;

  // Mi espacio es un panel solo para administradores; a los demás los saca al home.
  if (!(await esAdmin(session))) {
    window.location.href = "/index.html";
    return;
  }

  const nombre = await nombreUsuario(session);
  document.getElementById("explorarTitulo").textContent = nombre
    ? `¡Qué gusto verte, ${nombre}!`
    : "¡Qué gusto verte!";

  document.body.classList.remove("explore--auth-pending");
})();

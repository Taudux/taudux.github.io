/* Protege el hub privado y completa su encabezado con la sesión activa. */

(async () => {
  const session = await requerirSesion();
  if (!session) return;

  const nombre = await nombreUsuario(session);
  document.getElementById("explorarTitulo").textContent = nombre
    ? `¡Qué gusto verte, ${nombre}!`
    : "¡Qué gusto verte!";
  document.body.classList.remove("explore--auth-pending");
})();

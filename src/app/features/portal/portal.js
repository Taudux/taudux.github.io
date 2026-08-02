/*
  Cableado del portal de cuenta: gate de sesión, conmutación de sección por el
  hash de la URL y el formulario de "Editar Perfil".

  La resolución del hash vive en portal.secciones.js, y la validación/diff del
  formulario en portal.perfil.js; ambos se cargan antes y dejan sus funciones
  en el ámbito global.

  Los errores del formulario van SIEMPRE a la región inline role="alert", nunca
  al canal global de telemetría de operaciones: ese canal ya dispara un toast
  genérico en navbar.js, y sumarle un mostrarToast propio duplicaría el aviso.
*/

(function () {
  const startup = document.getElementById("portalStartup");
  const contenido = document.getElementById("portalContent");

  function enlaces() {
    return Array.from(document.querySelectorAll(".portal__nav-link"));
  }

  function secciones() {
    return Array.from(document.querySelectorAll(".portal__section"));
  }

  function mostrarSeccion(id) {
    secciones().forEach((seccion) => {
      seccion.hidden = seccion.dataset.seccion !== id;
    });
    enlaces().forEach((enlace) => {
      if (enlace.dataset.seccion === id) enlace.setAttribute("aria-current", "page");
      else enlace.removeAttribute("aria-current");
    });
  }

  function aplicarHash() {
    mostrarSeccion(resolverSeccionActiva(window.location.hash, SECCIONES_PORTAL));
  }

  // El campo culpable de un error recibe aria-describedby + aria-invalid; el
  // resto de los inputs del form los pierde en cada intento nuevo.
  function marcarCampoInvalido(form, nombreCampo) {
    form.querySelectorAll("input").forEach((input) => {
      if (input.name === nombreCampo) {
        input.setAttribute("aria-describedby", "perfilStatus");
        input.setAttribute("aria-invalid", "true");
      } else {
        input.removeAttribute("aria-describedby");
        input.removeAttribute("aria-invalid");
      }
    });
  }

  function limpiarCamposInvalidos(form) {
    form.querySelectorAll("input").forEach((input) => {
      input.removeAttribute("aria-describedby");
      input.removeAttribute("aria-invalid");
    });
  }

  function mostrarErrorPerfil(form, estado, { campo, mensaje }) {
    estado.textContent = mensaje;
    estado.hidden = false;
    if (campo) marcarCampoInvalido(form, campo);
    estado.focus();
  }

  function ocultarErrorPerfil(form, estado) {
    if (estado.hidden) return;
    estado.hidden = true;
    estado.textContent = "";
    limpiarCamposInvalidos(form);
  }

  function leerFormularioPerfil(form) {
    return {
      nombre: form.elements.nombre.value,
      apellidos: form.elements.apellidos.value,
      telefono: form.elements.telefono.value,
    };
  }

  function poblarFormularioPerfil(form, perfil) {
    const datos = normalizarPerfil(perfil || {});
    form.elements.nombre.value = datos.nombre;
    form.elements.apellidos.value = datos.apellidos;
    form.elements.telefono.value = datos.telefono;
    return datos;
  }

  function configurarFormularioPerfil(session, perfilInicial) {
    const form = document.getElementById("formPerfil");
    const estado = document.getElementById("perfilStatus");
    if (!form || !estado) return;

    let original = poblarFormularioPerfil(form, perfilInicial);

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();

      const actual = normalizarPerfil(leerFormularioPerfil(form));
      const cambios = camposModificados(original, actual);
      if (Object.keys(cambios).length === 0) {
        ocultarErrorPerfil(form, estado);
        return;
      }

      // Solo se valida lo que realmente va a cambiar: un dato legacy inválido
      // en un campo que el usuario no tocó no debe bloquear guardar otro.
      const validacion = validarCambios(cambios);
      if (!validacion.ok) {
        mostrarErrorPerfil(form, estado, validacion);
        return;
      }

      establecerFormularioOcupado(form, true);
      try {
        const resultado = await actualizarPerfil(session.user.id, cambios);
        if (!resultado.ok) {
          mostrarErrorPerfil(form, estado, { mensaje: resultado.mensaje });
          return;
        }
        original = poblarFormularioPerfil(form, resultado.data);
        ocultarErrorPerfil(form, estado);
        mostrarToast("Cambios guardados.", "success");
      } finally {
        establecerFormularioOcupado(form, false);
      }
    });
  }

  // El campo culpable de un error recibe aria-describedby + aria-invalid; el
  // resto de los inputs del form los pierde en cada intento nuevo. Réplica del
  // helper de "Editar Perfil" pero apuntando a contrasenaStatus.
  function marcarCampoInvalidoContrasena(form, nombreCampo) {
    form.querySelectorAll("input").forEach((input) => {
      if (input.name === nombreCampo) {
        input.setAttribute("aria-describedby", "contrasenaStatus");
        input.setAttribute("aria-invalid", "true");
      } else {
        input.removeAttribute("aria-describedby");
        input.removeAttribute("aria-invalid");
      }
    });
  }

  function limpiarCamposInvalidosContrasena(form) {
    form.querySelectorAll("input").forEach((input) => {
      input.removeAttribute("aria-describedby");
      input.removeAttribute("aria-invalid");
    });
  }

  function mostrarErrorContrasena(form, estado, { campo, mensaje }) {
    estado.textContent = mensaje;
    estado.hidden = false;
    if (campo) marcarCampoInvalidoContrasena(form, campo);
    estado.focus();
    mostrarToast(mensaje, "error");
  }

  function ocultarErrorContrasena(form, estado) {
    if (estado.hidden) return;
    estado.hidden = true;
    estado.textContent = "";
    limpiarCamposInvalidosContrasena(form);
  }

  function limpiarFormularioContrasena(form) {
    form.elements.actual.value = "";
    form.elements.nueva.value = "";
    form.elements.confirmar.value = "";
  }

  function configurarFormularioContrasena(session) {
    const form = document.getElementById("formContrasena");
    const estado = document.getElementById("contrasenaStatus");
    if (!form || !estado) return;

    configurarRequisitosContrasena(
      document.getElementById("contrasenaNueva"),
      document.getElementById("contrasenaNuevaReqs"),
    );
    configurarCoincidenciaContrasenas(
      document.getElementById("contrasenaNueva"),
      document.getElementById("contrasenaConfirmar"),
      document.getElementById("contrasenaMatch"),
    );

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();

      const actual = form.elements.actual.value;
      const nueva = form.elements.nueva.value;
      const confirmar = form.elements.confirmar.value;

      if (nueva !== confirmar) {
        mostrarErrorContrasena(form, estado, {
          campo: "confirmar",
          mensaje: "Las contraseñas no coinciden.",
        });
        form.elements.confirmar.focus();
        return;
      }

      if (!contrasenaValida(nueva)) {
        mostrarErrorContrasena(form, estado, {
          campo: "nueva",
          mensaje: "La contraseña no cumple los requisitos.",
        });
        return;
      }

      establecerFormularioOcupado(form, true);
      try {
        // Re-autenticación obligatoria: cambiar la contraseña sin confirmar la
        // actual dejaría secuestrar la cuenta a quien encuentre una sesión
        // abierta sin vigilancia.
        const reauth = await supabaseClient.auth.signInWithPassword({
          email: session.user.email,
          password: actual,
        });
        if (reauth.error) {
          mostrarErrorContrasena(form, estado, {
            campo: "actual",
            mensaje: "Contraseña actual incorrecta.",
          });
          return;
        }

        const resultado = await cambiarContrasena(nueva);
        if (!resultado.ok) {
          mostrarErrorContrasena(form, estado, { mensaje: resultado.mensaje });
          return;
        }

        await cerrarSesion({ scope: "others" });
        limpiarFormularioContrasena(form);
        ocultarErrorContrasena(form, estado);
        mostrarToast("Contraseña actualizada. Cerramos tus otras sesiones.", "success");
      } finally {
        establecerFormularioOcupado(form, false);
      }
    });
  }

  function configurarCierreSesion() {
    const boton = document.getElementById("botonCerrarSesion");
    if (!boton) return;

    boton.addEventListener("click", async () => {
      await cerrarSesion();
      window.location.href = "/";
    });
  }

  function mostrarErrorEliminarCuenta(form, estado, mensaje) {
    estado.textContent = mensaje;
    estado.hidden = false;
    form.elements.contrasena.setAttribute("aria-describedby", "eliminarCuentaStatus");
    form.elements.contrasena.setAttribute("aria-invalid", "true");
    estado.focus();
    mostrarToast(mensaje, "error");
  }

  function ocultarErrorEliminarCuenta(form, estado) {
    if (estado.hidden) return;
    estado.hidden = true;
    estado.textContent = "";
    form.elements.contrasena.removeAttribute("aria-describedby");
    form.elements.contrasena.removeAttribute("aria-invalid");
  }

  /*
    Doble barrera antes de un borrado irreversible: primero la contraseña actual
    (que alguien con la sesión abierta no necesariamente conoce) y después el
    correo tipeado en el diálogo. El toast del diálogo se emite recién cuando la
    promesa resuelve, porque el top layer del <dialog> taparía cualquier toast
    lanzado antes.
  */
  function configurarEliminarCuenta(session) {
    const boton = document.getElementById("botonMostrarEliminarCuenta");
    const form = document.getElementById("formEliminarCuenta");
    const estado = document.getElementById("eliminarCuentaStatus");
    if (!boton || !form || !estado) return;

    boton.addEventListener("click", () => {
      form.hidden = false;
      boton.hidden = true;
      form.elements.contrasena.focus();
    });

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      ocultarErrorEliminarCuenta(form, estado);

      const contrasena = form.elements.contrasena.value;
      if (!contrasena) {
        mostrarErrorEliminarCuenta(form, estado, "Escribe tu contraseña actual para continuar.");
        return;
      }

      establecerFormularioOcupado(form, true);
      try {
        const reauth = await supabaseClient.auth.signInWithPassword({
          email: session.user.email,
          password: contrasena,
        });
        if (reauth.error) {
          mostrarErrorEliminarCuenta(form, estado, "Contraseña actual incorrecta.");
          return;
        }

        const confirmado = await confirmarConTexto({
          titulo: "Eliminar cuenta",
          mensaje: `Se eliminarán tu cuenta (${session.user.email}) y tu perfil de forma permanente. Esta acción no se puede deshacer.`,
          textoEsperado: session.user.email,
          etiquetaEntrada: "Escribe tu correo para confirmar:",
          etiquetaConfirmar: "Eliminar cuenta",
        });
        if (!confirmado) {
          form.elements.contrasena.value = "";
          return;
        }

        const resultado = await eliminarCuenta();
        if (!resultado.ok) {
          mostrarErrorEliminarCuenta(form, estado, resultado.mensaje);
          return;
        }

        // La cuenta ya no existe: el signOut solo limpia la sesión local, y si
        // fallara igual hay que sacar al usuario de un portal sin dueño.
        await cerrarSesion({ scope: "local" });
        window.location.href = "/";
      } finally {
        establecerFormularioOcupado(form, false);
      }
    });
  }

  function configurarSeccionCuenta(session) {
    const email = document.getElementById("cuentaEmail");
    if (email) email.value = session.user.email || "";

    configurarFormularioContrasena(session);
    configurarCierreSesion();
    configurarEliminarCuenta(session);
  }

  // El perfil llega de la BD en snake_case (avisos_curso_nuevo); el núcleo
  // puro trabaja en camelCase, igual que el name del checkbox del form.
  function poblarFormularioCorreo(form, perfil) {
    const datos = normalizarPreferenciasCorreo({
      avisosCursoNuevo: perfil && perfil.avisos_curso_nuevo,
    });
    form.elements.avisosCursoNuevo.checked = datos.avisosCursoNuevo;
    return datos;
  }

  function leerFormularioCorreo(form) {
    return { avisosCursoNuevo: form.elements.avisosCursoNuevo.checked };
  }

  function mostrarErrorCorreo(estado, mensaje) {
    estado.textContent = mensaje;
    estado.hidden = false;
    estado.focus();
  }

  function ocultarErrorCorreo(estado) {
    if (estado.hidden) return;
    estado.hidden = true;
    estado.textContent = "";
  }

  function configurarFormularioCorreo(session, perfilInicial) {
    const form = document.getElementById("formCorreo");
    const estado = document.getElementById("correoStatus");
    if (!form || !estado) return;

    let original = poblarFormularioCorreo(form, perfilInicial);

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();

      const actual = leerFormularioCorreo(form);
      const cambios = cambiosPreferenciasCorreo(original, actual);
      if (Object.keys(cambios).length === 0) {
        ocultarErrorCorreo(estado);
        return;
      }

      establecerFormularioOcupado(form, true);
      try {
        const resultado = await actualizarPerfil(session.user.id, cambios);
        if (!resultado.ok) {
          mostrarErrorCorreo(estado, resultado.mensaje);
          return;
        }
        original = poblarFormularioCorreo(form, resultado.data);
        ocultarErrorCorreo(estado);
        mostrarToast("Preferencia guardada.", "success");
      } finally {
        establecerFormularioOcupado(form, false);
      }
    });
  }

  async function inicializarPortal() {
    // Sin sesión, requerirSesion ya navegó al login con ?next=: no hay nada más
    // que hacer en esta página, ni siquiera revelar el contenido.
    const session = await requerirSesion();
    if (!session) return;

    aplicarHash();
    window.addEventListener("hashchange", aplicarHash);

    const perfil = await obtenerPerfil(session);
    configurarFormularioPerfil(session, perfil);
    configurarSeccionCuenta(session);
    configurarFormularioCorreo(session, perfil);

    if (contenido) contenido.hidden = false;
    if (startup) {
      startup.hidden = true;
      startup.setAttribute("aria-busy", "false");
    }
  }

  inicializarPortal();
})();

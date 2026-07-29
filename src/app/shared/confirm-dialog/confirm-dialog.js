/*
  Diálogo de confirmación para acciones destructivas: obliga a escribir un texto
  exacto antes de habilitar el botón de confirmar. No tiene dependencias y expone
  confirmarConTexto(opciones) en el scope global.

  Se apoya en el <dialog> nativo por showModal(): trae focus trap, cierre con Esc
  (evento cancel), inertización del fondo y ::backdrop sin código propio.

  El top layer del <dialog> gana a cualquier z-index, incluido --z-toast, así que
  un toast emitido con el diálogo abierto quedaría tapado: notificar siempre
  después de que la promesa resuelva.

  crearDialogoConfirmacion({ documento }) queda expuesto para los tests, que
  inyectan un documento falso porque el harness del repo no tiene DOM real.
*/

function normalizarTextoConfirmacion(valor) {
  return String(valor ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es");
}

// Ignora mayúsculas y espacios sobrantes, pero no los acentos: el texto está a la
// vista y aflojar las tildes debilitaría la barrera sin ganar usabilidad.
function coincideTextoConfirmacion(valor, esperado) {
  const normalizado = normalizarTextoConfirmacion(valor);
  return normalizado !== "" && normalizado === normalizarTextoConfirmacion(esperado);
}

function crearDialogoConfirmacion({ documento }) {
  function construir({ titulo, mensaje, textoEsperado, etiquetaConfirmar, etiquetaCancelar }) {
    const dialogo = documento.createElement("dialog");
    dialogo.className = "confirm-dialog panel";
    dialogo.setAttribute("aria-labelledby", "confirmDialogTitulo");
    dialogo.setAttribute("aria-describedby", "confirmDialogMensaje");

    const encabezado = documento.createElement("h2");
    encabezado.className = "confirm-dialog__titulo";
    encabezado.id = "confirmDialogTitulo";
    encabezado.textContent = titulo;

    const cuerpo = documento.createElement("p");
    cuerpo.className = "confirm-dialog__mensaje";
    cuerpo.id = "confirmDialogMensaje";
    cuerpo.textContent = mensaje;

    const etiqueta = documento.createElement("label");
    etiqueta.className = "confirm-dialog__etiqueta";
    etiqueta.setAttribute("for", "confirmDialogEntrada");
    etiqueta.textContent = "Escribe el nombre exacto para confirmar:";

    const esperado = documento.createElement("strong");
    esperado.className = "confirm-dialog__esperado";
    esperado.textContent = textoEsperado;

    const entrada = documento.createElement("input");
    entrada.className = "field confirm-dialog__entrada";
    entrada.id = "confirmDialogEntrada";
    entrada.type = "text";
    entrada.value = "";
    entrada.setAttribute("autocomplete", "off");
    entrada.setAttribute("spellcheck", "false");
    entrada.setAttribute("aria-describedby", "confirmDialogAyuda");

    const ayuda = documento.createElement("p");
    ayuda.className = "confirm-dialog__ayuda";
    ayuda.id = "confirmDialogAyuda";
    ayuda.setAttribute("role", "status");
    ayuda.setAttribute("aria-live", "polite");

    const acciones = documento.createElement("div");
    acciones.className = "confirm-dialog__acciones";

    const cancelar = documento.createElement("button");
    cancelar.className = "button button--outline confirm-dialog__cancelar";
    cancelar.type = "button";
    cancelar.textContent = etiquetaCancelar || "Cancelar";

    const confirmar = documento.createElement("button");
    confirmar.className = "button confirm-dialog__confirmar";
    confirmar.type = "button";
    confirmar.textContent = etiquetaConfirmar || "Confirmar";
    confirmar.disabled = true;

    acciones.append(cancelar, confirmar);
    dialogo.append(encabezado, cuerpo, etiqueta, esperado, entrada, ayuda, acciones);

    return { dialogo, entrada, ayuda, cancelar, confirmar };
  }

  function abrir(opciones) {
    const { dialogo, entrada, ayuda, cancelar, confirmar } = construir(opciones);
    const textoEsperado = opciones.textoEsperado;
    const disparador = documento.activeElement;

    documento.body.appendChild(dialogo);

    if (typeof dialogo.showModal !== "function") {
      console.error("[confirm-dialog]", { contexto: "showModal no disponible" });
      dialogo.remove();
      return Promise.resolve(false);
    }

    return new Promise((resolver) => {
      const cerrar = (valor) => {
        dialogo.returnValue = valor;
        dialogo.close(valor);
      };

      entrada.addEventListener("input", () => {
        const coincide = coincideTextoConfirmacion(entrada.value, textoEsperado);
        confirmar.disabled = !coincide;
        ayuda.textContent = coincide ? "El texto coincide." : "";
      });

      cancelar.addEventListener("click", () => cerrar("cancelar"));

      // Revalida en vez de confiar solo en el disabled.
      confirmar.addEventListener("click", () => {
        if (!coincideTextoConfirmacion(entrada.value, textoEsperado)) return;
        cerrar("confirmar");
      });

      // El backdrop reporta el propio dialogo como target. Cerrar acá solo puede
      // cancelar, nunca confirmar, así que es seguro.
      dialogo.addEventListener("click", (evento) => {
        if (evento.target === dialogo) cerrar("cancelar");
      });

      dialogo.addEventListener("close", () => {
        dialogo.remove();
        if (disparador && typeof disparador.focus === "function") disparador.focus();
        resolver(dialogo.returnValue === "confirmar");
      });

      dialogo.showModal();
      void dialogo.offsetWidth;
      dialogo.classList.add("confirm-dialog--visible");
      entrada.focus();
    });
  }

  return Object.freeze({ abrir });
}

function confirmarConTexto(opciones) {
  return crearDialogoConfirmacion({ documento: document }).abrir(opciones);
}

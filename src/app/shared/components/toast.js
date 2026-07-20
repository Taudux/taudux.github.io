/*
  Notificaciones toast: entran desde la derecha, duran 3 segundos y se van solas.

  Uso:  mostrarToast("Te enviamos un correo", "success");
        mostrarToast("Correo o contraseña incorrectos", "error");

  No tiene dependencias; puede cargarse en cualquier página.
*/

const TOAST_DURACION_MS = 3000;

// Crea el contenedor la primera vez que se necesita.
// aria-live="polite" hace que los lectores de pantalla anuncien el mensaje
// sin robar el foco al usuario.
function obtenerContenedorToast() {
  let contenedor = document.getElementById("toastContainer");
  if (contenedor) return contenedor;

  contenedor = document.createElement("div");
  contenedor.id = "toastContainer";
  contenedor.className = "toast-container";
  contenedor.setAttribute("role", "status");
  contenedor.setAttribute("aria-live", "polite");
  document.body.appendChild(contenedor);
  return contenedor;
}

// Programa la salida del toast y su borrado del DOM
function programarCierreToast(toast) {
  clearTimeout(toast._temporizador);

  toast._temporizador = setTimeout(() => {
    toast.classList.remove("visible");

    // Respaldo por si transitionend no dispara (pestaña oculta, reduced-motion…)
    const borrar = () => toast.remove();
    const respaldo = setTimeout(borrar, 600);
    toast.addEventListener("transitionend", () => {
      clearTimeout(respaldo);
      borrar();
    }, { once: true });
  }, TOAST_DURACION_MS);
}

function mostrarToast(mensaje, tipo) {
  const texto = String(mensaje || "").trim();
  if (!texto) return;

  const clase = tipo === "error" ? "error" : "success";
  const contenedor = obtenerContenedorToast();

  // Si el mismo mensaje ya está en pantalla, solo reinicia su temporizador.
  // Evita duplicados cuando un evento se dispara más de una vez.
  const existente = Array.from(contenedor.children).find(
    (t) => t.dataset.mensaje === texto && t.dataset.tipo === clase
  );
  if (existente) {
    programarCierreToast(existente);
    return existente;
  }

  const toast = document.createElement("div");
  toast.className = "toast toast-" + clase;
  toast.dataset.mensaje = texto;
  toast.dataset.tipo = clase;
  toast.textContent = texto; // textContent evita inyección de HTML

  contenedor.appendChild(toast);

  // Fuerza un reflow para que la transición de entrada se aplique
  void toast.offsetWidth;
  toast.classList.add("visible");

  programarCierreToast(toast);
  return toast;
}

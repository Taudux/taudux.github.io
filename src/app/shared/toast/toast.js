/*
  Notificaciones toast. No tiene dependencias y expone mostrarToast(mensaje,
  tipo) en el scope global.
*/

const TOAST_DURACION_MS = 3000;

function obtenerContenedorToast() {
  let contenedor = document.getElementById("toastContainer");
  if (contenedor) return contenedor;

  contenedor = document.createElement("div");
  contenedor.id = "toastContainer";
  contenedor.className = "toast-stack";
  contenedor.setAttribute("role", "status");
  contenedor.setAttribute("aria-live", "polite");
  document.body.appendChild(contenedor);
  return contenedor;
}

function programarCierreToast(toast) {
  clearTimeout(toast._temporizador);

  toast._temporizador = setTimeout(() => {
    toast.classList.remove("toast--visible");

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
  const existente = Array.from(contenedor.children).find(
    (toast) => toast.dataset.mensaje === texto && toast.dataset.tipo === clase
  );

  if (existente) {
    programarCierreToast(existente);
    return existente;
  }

  const toast = document.createElement("div");
  toast.className = `toast toast--${clase}`;
  toast.dataset.mensaje = texto;
  toast.dataset.tipo = clase;
  toast.textContent = texto;
  contenedor.appendChild(toast);

  void toast.offsetWidth;
  toast.classList.add("toast--visible");
  programarCierreToast(toast);
  return toast;
}

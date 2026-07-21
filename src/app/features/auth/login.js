/*
  Comportamiento de login, registro y recuperación. Depende de auth.service.js
  y toast.js, cargados antes de este archivo.
*/

const tabLogin = document.getElementById("tabLogin");
const tabSignup = document.getElementById("tabSignup");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const recoveryForm = document.getElementById("recoveryForm");
const authTabs = document.querySelector(".auth__tabs");
const authSubtitle = document.getElementById("authSubtitle");
const forgotLink = document.getElementById("forgotLink");
const reenviarLink = document.getElementById("reenviarLink");
const signupPais = document.getElementById("signupPais");
const signupPrefijo = document.getElementById("signupPrefijo");
const signupTelefono = document.getElementById("signupTelefono");
const signupPassword = document.getElementById("signupPassword");
const passwordReqs = document.getElementById("passwordReqs");

const requisitosPassword = {
  longitud: (password) => password.length >= 8,
  mayuscula: (password) => /[A-Z]/.test(password),
  minuscula: (password) => /[a-z]/.test(password),
  digito: (password) => /\d/.test(password),
};

const passwordValida = (password) =>
  Object.values(requisitosPassword).every((validar) => validar(password));

function evaluarPassword() {
  const password = signupPassword.value;

  passwordReqs.querySelectorAll(".password-requirements__item").forEach((item) => {
    const cumple = requisitosPassword[item.dataset.req](password);
    item.classList.toggle("password-requirements__item--valid", password.length > 0 && cumple);
    item.classList.toggle("password-requirements__item--invalid", password.length > 0 && !cumple);
  });
}

function alternarFormularioOculto(formulario, oculto) {
  formulario.classList.toggle("auth__form--hidden", oculto);
}

function alternarEnlaceOculto(enlace, oculto) {
  enlace.classList.toggle("auth__link--hidden", oculto);
}

function mostrarTab(tab) {
  const esLogin = tab === "login";
  tabLogin.classList.toggle("auth__tab--active", esLogin);
  tabSignup.classList.toggle("auth__tab--active", !esLogin);
  alternarFormularioOculto(loginForm, !esLogin);
  alternarFormularioOculto(signupForm, esLogin);
  alternarEnlaceOculto(forgotLink, !esLogin);
  alternarEnlaceOculto(reenviarLink, true);
  authSubtitle.textContent = esLogin
    ? "Inicia sesión para continuar"
    : "Crea tu cuenta para acceder a la herramienta";
}

function mostrarModoRecuperacion() {
  authTabs.classList.add("auth__tabs--hidden");
  alternarFormularioOculto(loginForm, true);
  alternarFormularioOculto(signupForm, true);
  alternarEnlaceOculto(forgotLink, true);
  alternarEnlaceOculto(reenviarLink, true);
  alternarFormularioOculto(recoveryForm, false);
  authSubtitle.textContent = "Escribe tu nueva contraseña";
}

function formatearTelefono(valor) {
  const digitos = valor.replace(/\D/g, "").slice(0, 10);
  const partes = [digitos.slice(0, 3)];
  if (digitos.length > 3) partes.push(digitos.slice(3, 6));
  if (digitos.length > 6) partes.push(digitos.slice(6, 10));
  return partes.filter(Boolean).join("-");
}

signupPassword.addEventListener("input", evaluarPassword);

document.querySelectorAll(".password-field__toggle").forEach((boton) => {
  const input = document.getElementById(boton.dataset.target);
  boton.addEventListener("click", () => {
    const mostrando = input.type === "text";
    input.type = mostrando ? "password" : "text";
    boton.classList.toggle("password-field__toggle--showing", !mostrando);
    boton.setAttribute("aria-label", mostrando ? "Mostrar contraseña" : "Ocultar contraseña");
  });
});

signupPais.addEventListener("change", () => {
  signupPrefijo.textContent = signupPais.value;
});

signupTelefono.addEventListener("input", () => {
  signupTelefono.value = formatearTelefono(signupTelefono.value);
});

tabLogin.addEventListener("click", () => mostrarTab("login"));
tabSignup.addEventListener("click", () => mostrarTab("signup"));

const enRecuperacion = window.location.hash.includes("type=recovery");
if (enRecuperacion) {
  mostrarModoRecuperacion();
} else {
  obtenerSesion().then((session) => {
    if (session) window.location.href = "/src/app/features/explore/explorar.html";
  });
}

loginForm.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const resultado = await iniciarSesion(email, password);

  if (resultado.ok) {
    window.location.href = "/src/app/features/explore/explorar.html";
  } else {
    mostrarToast(resultado.mensaje, "error");
    alternarEnlaceOculto(reenviarLink, !resultado.noConfirmado);
  }
});

reenviarLink.addEventListener("click", async (evento) => {
  evento.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();

  if (!email) {
    mostrarToast("Escribe tu correo arriba y vuelve a intentarlo.", "error");
    return;
  }

  const resultado = await reenviarConfirmacion(email);
  mostrarToast(
    resultado.ok ? "Te reenviamos el correo de confirmación. Revisa tu bandeja." : resultado.mensaje,
    resultado.ok ? "success" : "error"
  );
});

signupForm.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const nombre = document.getElementById("signupName").value.trim();
  const apellidos = document.getElementById("signupApellidos").value.trim();
  const prefijo = signupPais.value;
  const numeroTelefono = signupTelefono.value.replace(/[\s-]/g, "");
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const passwordConfirm = document.getElementById("signupPasswordConfirm").value;

  if (!passwordValida(password)) {
    mostrarToast("La contraseña no cumple los requisitos.", "error");
    return;
  }

  if (password !== passwordConfirm) {
    mostrarToast("Las contraseñas no coinciden.", "error");
    return;
  }

  if (!/^\d{10}$/.test(numeroTelefono)) {
    mostrarToast("Ingresa un número de teléfono válido.", "error");
    return;
  }

  const telefono = `${prefijo} ${numeroTelefono}`;
  const resultado = await registrarUsuario(email, password, nombre, apellidos, telefono);

  if (resultado.ok) {
    mostrarToast("¡Cuenta creada! Revisa tu correo para confirmarla antes de acceder.", "success");
    signupForm.reset();
    evaluarPassword();
  } else {
    mostrarToast(resultado.mensaje, "error");
  }
});

forgotLink.addEventListener("click", async (evento) => {
  evento.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();

  if (!email) {
    mostrarToast("Escribe tu correo arriba y vuelve a intentarlo.", "error");
    return;
  }

  const resultado = await recuperarContrasena(email);
  mostrarToast(
    resultado.ok ? "Te enviamos un correo para restablecer tu contraseña." : resultado.mensaje,
    resultado.ok ? "success" : "error"
  );
});

recoveryForm.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const password = document.getElementById("recoveryPassword").value;
  const passwordConfirm = document.getElementById("recoveryPasswordConfirm").value;

  if (password !== passwordConfirm) {
    mostrarToast("Las contraseñas no coinciden.", "error");
    return;
  }

  const resultado = await cambiarContrasena(password);
  if (!resultado.ok) {
    mostrarToast(resultado.mensaje, "error");
    return;
  }

  await cerrarSesion();
  history.replaceState(null, "", window.location.pathname);
  authTabs.classList.remove("auth__tabs--hidden");
  alternarFormularioOculto(recoveryForm, true);
  recoveryForm.reset();
  mostrarTab("login");
  mostrarToast("Contraseña actualizada. Inicia sesión con tu nueva contraseña.", "success");
});

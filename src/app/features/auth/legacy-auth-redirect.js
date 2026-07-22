/* Conserva enlaces antiguos de login y recuperación sin perder tokens ni destino. */

const parametrosLegacy = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const consultaLegacy = new URLSearchParams(window.location.search);
const esRecuperacionLegacy =
  parametrosLegacy.get("type") === "recovery" ||
  parametrosLegacy.has("access_token") ||
  parametrosLegacy.has("error_code") ||
  consultaLegacy.get("type") === "recovery" ||
  consultaLegacy.has("code") ||
  consultaLegacy.has("error_code");
const destinoLegacy = esRecuperacionLegacy
  ? "/src/app/features/auth/reset-password/"
  : "/src/app/features/auth/login/";

window.location.replace(`${destinoLegacy}${window.location.search}${window.location.hash}`);

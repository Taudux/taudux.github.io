// Lógica pura para notify-course-published: sin Deno, sin fetch, sin nada
// async que no sea inyectado. Reusada tanto por index.ts como por los tests
// de Node.

export const PRODUCTION_ORIGINS = new Set(["https://taudux.com"]);

export const MAX_ANUNCIOS_POR_INVOCACION = 2;
export const PAGINA_DESTINATARIOS = 100;
export const PRESUPUESTO_MS_DEFAULT = 40000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXPO_TOKEN_RE = /^ExponentPushToken\[[^\]\s]+\]$/;

export function allowedOrigin(origin) {
  if (!origin || origin === "null") return false;
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.origin === origin && url.protocol === "http:" && Boolean(url.port) &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function constantTimeEquals(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  const length = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let index = 0; index < length; index++) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;
    const rightCode = index < right.length ? right.charCodeAt(index) : 0;
    diff |= leftCode ^ rightCode;
  }
  return diff === 0;
}

export function resolverModoAutorizacion({ origin, authorization, cronSecretHeader, cronSecretEnv, esAdmin }) {
  if (typeof cronSecretEnv === "string" && cronSecretEnv.length > 0) {
    if (constantTimeEquals(cronSecretHeader, cronSecretEnv)) {
      return "cron";
    }
  }
  if (allowedOrigin(origin) && authorization && esAdmin === true) {
    return "admin";
  }
  return null;
}

export function esEmailValido(email) {
  return typeof email === "string" && EMAIL_RE.test(email);
}

// The push counterpart of esEmailValido. Its main job is discarding the null
// tokens produced by the left join in destinatarios_push_curso_anuncio: users
// without the app installed still come back as rows, on purpose, so the
// pagination contract keeps working.
export function esTokenExpoValido(token) {
  return typeof token === "string" && EXPO_TOKEN_RE.test(token);
}

export function debePausar(elapsedMs, presupuestoMs = PRESUPUESTO_MS_DEFAULT) {
  return elapsedMs > presupuestoMs;
}

export function siguienteCursor(destinatarios, cursorActual) {
  if (!Array.isArray(destinatarios) || destinatarios.length === 0) return cursorActual;
  return destinatarios[destinatarios.length - 1].id;
}

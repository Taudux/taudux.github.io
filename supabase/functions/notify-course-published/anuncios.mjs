// Lógica pura para notify-course-published: sin Deno, sin fetch, sin nada
// async que no sea inyectado. Reusada tanto por index.ts como por los tests
// de Node.

export const PRODUCTION_ORIGINS = new Set(["https://taudux.com", "https://taudux.github.io"]);

export const MAX_ANUNCIOS_POR_INVOCACION = 2;
export const PAGINA_DESTINATARIOS = 100;
export const PRESUPUESTO_MS_DEFAULT = 40000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export function construirLoteResend({ titulo, cursoId, destinatarios, siteUrl, remitente }) {
  void cursoId;
  const unsubscribeUrl = `${siteUrl}/app/features/portal/#correo`;
  const catalogoUrl = `${siteUrl}/app/features/courses/cursos.html`;
  return destinatarios.map((destinatario) => ({
    from: remitente,
    to: [destinatario.email],
    subject: `Nuevo curso en Taudux: ${titulo}`,
    text: `Se publicó un nuevo curso en Taudux: ${titulo}.\n\n` +
      `Podés verlo en el catálogo: ${catalogoUrl}\n\n` +
      `Si no querés recibir estos avisos, podés darte de baja acá: ${unsubscribeUrl}`,
    html: `<p>Se publicó un nuevo curso en Taudux: <strong>${titulo}</strong>.</p>` +
      `<p><a href="${catalogoUrl}">Ver el catálogo de cursos</a></p>` +
      `<p style="font-size:12px;color:#666;">Si no querés recibir estos avisos, ` +
      `<a href="${unsubscribeUrl}">dejá de recibirlos acá</a>.</p>`,
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
  }));
}

export function debePausar(elapsedMs, presupuestoMs = PRESUPUESTO_MS_DEFAULT) {
  return elapsedMs > presupuestoMs;
}

export function siguienteCursor(destinatarios, cursorActual) {
  if (!Array.isArray(destinatarios) || destinatarios.length === 0) return cursorActual;
  return destinatarios[destinatarios.length - 1].id;
}

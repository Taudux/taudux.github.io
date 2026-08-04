// Lógica pura para notify-course-published: sin Deno, sin fetch, sin nada
// async que no sea inyectado. Reusada tanto por index.ts como por los tests
// de Node.

export const PRODUCTION_ORIGINS = new Set(["https://taudux.com", "https://taudux.github.io"]);

export const MAX_ANUNCIOS_POR_INVOCACION = 2;
export const PAGINA_DESTINATARIOS = 100;
export const PRESUPUESTO_MS_DEFAULT = 40000;

// Expo rejects requests carrying more than 100 messages. A page is 100 *users*,
// but one user may have several devices, so a single page can yield more tokens
// than fit in one request.
export const MAX_MENSAJES_EXPO = 100;

// The Android channel the app creates with MAX importance. Without it Android
// files the notification under the default channel and drops the priority.
export const ANDROID_CHANNEL_ID = "course-announcements";

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

export function construirLoteResend({ titulo, cursoId, destinatarios, siteUrl, remitente }) {
  void cursoId;
  const unsubscribeUrl = `${siteUrl}/app/features/portal/#correo`;
  const catalogoUrl = `${siteUrl}/app/features/courses/cursos.html`;
  return destinatarios.map((destinatario) => ({
    from: remitente,
    to: [destinatario.email],
    subject: `Nuevo curso en Taudux: ${titulo}`,
    text: `Se publicó un nuevo curso en Taudux: ${titulo}.\n\n` +
      `Puedes verlo en el catálogo: ${catalogoUrl}\n\n` +
      `Si no quieres recibir estos avisos, puedes darte de baja aquí: ${unsubscribeUrl}`,
    html: `<p>Se publicó un nuevo curso en Taudux: <strong>${titulo}</strong>.</p>` +
      `<p><a href="${catalogoUrl}">Ver el catálogo de cursos</a></p>` +
      `<p style="font-size:12px;color:#666;">Si no quieres recibir estos avisos, ` +
      `<a href="${unsubscribeUrl}">deja de recibirlos aquí</a>.</p>`,
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
  }));
}

// The push counterpart of esEmailValido. Its main job is discarding the null
// tokens produced by the left join in destinatarios_push_curso_anuncio: users
// without the app installed still come back as rows, on purpose, so the
// pagination contract keeps working.
export function esTokenExpoValido(token) {
  return typeof token === "string" && EXPO_TOKEN_RE.test(token);
}

export function construirLotePush({ titulo, cursoId, destinatarios, siteUrl }) {
  void siteUrl;
  return destinatarios.map((destinatario) => ({
    to: destinatario.expo_push_token,
    title: `Nuevo curso: ${titulo}`,
    body: `Ya puedes verlo en el catálogo de Taudux.`,
    channelId: ANDROID_CHANNEL_ID,
    // The app reads this to open the course straight from the notification.
    data: { cursoId },
  }));
}

export function trocearLotePush(mensajes, maximo = MAX_MENSAJES_EXPO) {
  const tandas = [];
  for (let inicio = 0; inicio < mensajes.length; inicio += maximo) {
    tandas.push(mensajes.slice(inicio, inicio + maximo));
  }
  return tandas;
}

// Expo answers with one ticket per message, positionally. Only
// DeviceNotRegistered means "the app is gone" and justifies dropping the token;
// every other error (rate limits, oversized payloads) is transient, and deleting
// on those would lose a device that is still alive.
export function tokensNoRegistrados(mensajes, respuesta) {
  const tickets = Array.isArray(respuesta?.data) ? respuesta.data : [];
  const muertos = [];
  for (const [index, ticket] of tickets.entries()) {
    if (ticket?.details?.error !== "DeviceNotRegistered") continue;
    const token = mensajes[index]?.to;
    if (typeof token === "string" && token.length > 0) muertos.push(token);
  }
  return muertos;
}

export function debePausar(elapsedMs, presupuestoMs = PRESUPUESTO_MS_DEFAULT) {
  return elapsedMs > presupuestoMs;
}

export function siguienteCursor(destinatarios, cursorActual) {
  if (!Array.isArray(destinatarios) || destinatarios.length === 0) return cursorActual;
  return destinatarios[destinatarios.length - 1].id;
}

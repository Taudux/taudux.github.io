// enviarPush: the "HOW it's sent", Expo's side. Takes push messages and
// posts them to Expo's send endpoint, chunked at 100 per request (Expo's
// hard limit) — that's an asymmetry with enviarEmail, not an oversight: Expo
// enforces the cap, Resend doesn't. Returns which tokens Expo reported as
// `DeviceNotRegistered`; it does NOT delete them. Deleting means touching
// `push_devices`, and a transport that knows the DB schema stops being a
// transport — that decision stays with the orchestrator.
//
// Not new: this is `enviarLotePush` + `trocearLotePush` + `tokensNoRegistrados`
// in `supabase/functions/notify-course-published/{index.ts:60-89,anuncios.mjs:103-124}`,
// extracted so future push senders don't have to copy them.

export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

// Paces the delay between Expo push chunk requests, in ms.
const EXPO_CHUNK_DELAY_MS = 600;

// Expo rejects requests carrying more than 100 messages. A page is 100 *users*,
// but one user may have several devices, so a single page can yield more tokens
// than fit in one request.
export const MAX_MENSAJES_EXPO = 100;

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

// Expo caps a request at 100 messages, so a page that yields more tokens than
// that goes out in several chunks. A partial failure stops the page: the cursor
// has not advanced yet, so the retry replays this page from its start.
export async function enviarPush(dependencies, mensajes) {
  const tandas = trocearLotePush(mensajes);
  const muertos = [];
  for (const tanda of tandas) {
    let response;
    try {
      response = await dependencies.fetchImpl(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tanda),
      });
    } catch {
      return { ok: false, reason: "expo_request_exception", muertos };
    }
    if (!response.ok) {
      return { ok: false, reason: `expo_push_failed_${response.status}`.slice(0, 160), muertos };
    }
    let cuerpo = null;
    try {
      cuerpo = await response.json();
    } catch {
      // A 2xx we cannot parse still delivered the batch. Losing the tickets only
      // costs us this round of dead-token cleanup, so it is not worth a retry.
      cuerpo = null;
    }
    muertos.push(...tokensNoRegistrados(tanda, cuerpo));
    await dependencies.sleep(EXPO_CHUNK_DELAY_MS);
  }
  return { ok: true, muertos };
}

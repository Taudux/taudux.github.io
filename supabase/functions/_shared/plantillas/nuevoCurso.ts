// plantilla nuevoCurso: the "WHAT it says". Takes course data (title,
// content type, etc.) and returns the message for each channel —
// `paraEmail()` → { subject, html, text } and `paraPush()` → { title, body,
// data } — for the single "a new course was published" announcement. One
// file, two formats, on purpose: they're one conceptual message, and
// splitting them into separate files invites the copy to drift out of sync
// between channels. This file does not know how to send anything; it only
// drafts.
//
// Not new: this is `construirLoteResend` + `construirLotePush` in
// `supabase/functions/notify-course-published/anuncios.mjs:64-101`,
// extracted down to "one message" (the recipient loop stays with the
// orchestrator). When moved, keep the plain-text body and the
// `List-Unsubscribe` header on the email side (they're what keeps it out of
// spam filters), and keep the `channelId` on the push side — it MUST match
// the notification channel the app creates in `taudux-mobile`, or Android
// files the notification under its default channel and drops the priority.

// The Android channel the app creates with MAX importance. Without it Android
// files the notification under the default channel and drops the priority.
export const ANDROID_CHANNEL_ID = "course-announcements";

export function paraEmail({ titulo, destinatario, siteUrl, remitente }) {
  const unsubscribeUrl = `${siteUrl}/app/features/portal/#correo`;
  const catalogoUrl = `${siteUrl}/app/features/courses/cursos.html`;
  return {
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
  };
}

export function paraPush({ titulo, cursoId, destinatario }) {
  return {
    to: destinatario.expo_push_token,
    title: `Nuevo curso: ${titulo}`,
    body: `Ya puedes verlo en el catálogo de Taudux.`,
    channelId: ANDROID_CHANNEL_ID,
    // The app reads this to open the course straight from the notification.
    data: { cursoId },
  };
}

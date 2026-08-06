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

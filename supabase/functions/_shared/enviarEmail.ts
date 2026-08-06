// enviarEmail: the "HOW it's sent". Takes a recipient, a subject, and HTML,
// and hands them to Resend. The Resend API key is read from a Supabase
// secret (Deno.env), never from the frontend. Every template reuses this —
// it knows nothing about courses, subscribers, or copy.
//
// Not new: this is `enviarLote` in
// `supabase/functions/notify-course-published/index.ts:38-55`, extracted so
// future senders (welcome email, reminder email) don't have to copy it.
// `_shared/` is not deployed by the Supabase CLI, so this file has no
// `deno.json` of its own — the importing function's `deno.json` resolves it.

export async function enviarEmail(dependencies, resendApiKey, mensajes) {
  try {
    const response = await dependencies.fetchImpl("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mensajes),
    });
    if (!response.ok) {
      return { ok: false, reason: `resend_batch_failed_${response.status}`.slice(0, 160) };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "resend_request_exception" };
  }
}

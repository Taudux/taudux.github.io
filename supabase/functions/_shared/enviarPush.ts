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

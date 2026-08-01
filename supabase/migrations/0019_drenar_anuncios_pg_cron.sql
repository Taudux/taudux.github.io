-- Move the announcement drain trigger into pg_cron. The GitHub Actions cron
-- (drenar-anuncios.yml) fires on a shared, best-effort scheduler that skips
-- roughly 7 of every 8 scheduled runs, turning a 10-25 minute delivery target
-- into ~2 hours in practice. pg_cron runs inside this database, is not
-- subject to that scheduler, and does not get disabled by 60 days of repo
-- inactivity.
--
-- The edge function does not change: this migration only changes who calls
-- notify-course-published, replicating the same request the GitHub workflow
-- already sends (see .github/workflows/drenar-anuncios.yml).
--
-- Only one of the two headers below carries anything secret:
--
-- * x-taudux-anuncios-secret is what actually authorizes cron mode
--   (notify-course-published/index.ts, constant-time compared). It is never
--   stored here — the repository is public. It is loaded out-of-band into
--   Supabase Vault and resolved by name at execution time from
--   vault.decrypted_secrets. Only the secret *name* lives in this file.
-- * The anon key in the Authorization header is not a secret: it is already
--   hardcoded and served to every visitor in
--   src/app/core/supabase/supabase-client.js, purely to satisfy the
--   platform's JWT check. It is inlined below like the project URL already
--   is, matching that same public value — nothing is gained by round-tripping
--   it through Vault.
--
-- Verify the target project is yqkvgfqplmbbcebrivpt before running this file.
--
-- Applying this migration twice is safe: the preflight validates
-- prerequisites, and the unschedule step runs before cron.schedule so
-- reapplying does not create a duplicate job.

begin;

do $preflight$
begin
  if to_regprocedure('cron.schedule(text, text, text)') is null then
    raise exception using
      errcode = 'P0001',
      message = '0019 preflight failed: pg_cron extension is required';
  end if;

  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    raise exception using
      errcode = 'P0001',
      message = '0019 preflight failed: pg_net extension is required';
  end if;

  if not exists (
    select 1 from vault.decrypted_secrets where name = 'anuncios_cron_secret'
  ) then
    raise exception using
      errcode = 'P0001',
      message = '0019 preflight failed: vault secret anuncios_cron_secret is required';
  end if;
end
$preflight$;

-- Unschedule by name via cron.job instead of calling cron.unschedule(text)
-- directly: some pg_cron versions raise if the job name does not exist yet,
-- which would break the first apply. Selecting by jobid is a silent no-op
-- when the job is not there.
select cron.unschedule(jobid)
from cron.job
where jobname = 'drenar_anuncios_curso';

select cron.schedule(
  'drenar_anuncios_curso',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://yqkvgfqplmbbcebrivpt.supabase.co/functions/v1/notify-course-published',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Public anon key, matches src/app/core/supabase/supabase-client.js.
      -- Satisfies the platform JWT check only; grants no authorization.
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlxa3ZnZnFwbG1iYmNlYnJpdnB0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0ODgxOTEsImV4cCI6MjEwMDA2NDE5MX0.wU-ylZ6agwkochwmOGe-7BROByw1qsvYpmqT5xDvF1Y',
      'x-taudux-anuncios-secret', (
        select decrypted_secret from vault.decrypted_secrets where name = 'anuncios_cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);

commit;

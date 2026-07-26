-- CRITICAL DEPLOYMENT PREFLIGHT
-- `supabase db push` is FORBIDDEN until the remote migration history is explicitly
-- verified and reconciled with these manually applied, non-idempotent 0001-0010 files.
-- No CLI initialization, project link, history reconciliation, or SQL application is
-- performed by this file or by keeping it in the repository.
--
-- Current safe procedure:
-- 1. In the Supabase Dashboard, confirm the exact target project/ref.
-- 2. Inspect `supabase_migrations.schema_migrations` and verify the live schema matches
--    the reviewed effects of 0001-0010; do not infer history from filenames alone.
-- 3. Verify `public.es_admin()` exists and capture the current `course-covers` bucket
--    plus all `storage.objects` policies before changing anything.
-- 4. Until history is reconciled, apply ONLY this complete 0011 file manually in the
--    target project's SQL editor. Never replay 0001-0010 through `db push`.
-- 5. After commit, verify the public bucket, exact 5 MiB/MIME limits, and absence of
--    client mutation policies. Then deploy `upload-course-cover` with JWT verification
--    enabled and smoke-test auth, decoding, upload, duplicate retry, public GET, and logs
--    before releasing the browser files.
--
-- Future CLI reconciliation concept (NOT executed): after explicit CLI initialization
-- and target linking, run `supabase migration list`, verify every corresponding schema
-- effect, then use `supabase migration repair --status applied <version>` separately for
-- each already-applied 0001-0010 version and for 0011 if it was applied manually. Re-check
-- the list before considering `db push`.
--
-- Rollback order: roll back browser files first, then the Edge Function. Preserve this
-- bucket while any course references it. If this migration created an unused bucket,
-- first verify that it contains no objects, then remove it through the Dashboard or
-- Storage APIs. Never delete rows directly from Storage-managed tables.

begin;

do $preflight$
declare
  conflicting_policies text;
begin
  if to_regprocedure('public.es_admin()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0011 preflight failed: public.es_admin() is required before course-cover Storage changes';
  end if;

  -- Policy predicates are arbitrary SQL. Reject all client mutation policies instead
  -- of guessing from policy text whether an unknown predicate excludes this bucket.
  select string_agg(format('%I (%s)', policyname, cmd), ', ' order by policyname)
  into conflicting_policies
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    and roles && array['public', 'anon', 'authenticated']::name[];

  if conflicting_policies is not null then
    raise exception using
      errcode = 'P0001',
      message = '0011 preflight failed: client Storage mutation policies require separate review',
      detail = conflicting_policies;
  end if;
end
$preflight$;

-- Public reads serve course covers without exposing object listing or management.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-covers',
  'course-covers',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

do $postconditions$
declare
  bucket storage.buckets%rowtype;
  desired_mime_types text[] := array['image/jpeg', 'image/png', 'image/webp'];
  conflicting_policies text;
begin
  select *
  into bucket
  from storage.buckets
  where id = 'course-covers';

  if not found then
    raise exception using
      errcode = 'P0001',
      message = '0011 postcondition failed: course-covers bucket is absent';
  end if;

  if bucket.name is distinct from 'course-covers'
    or bucket.public is distinct from true
    or bucket.file_size_limit is distinct from 5242880
    or bucket.allowed_mime_types is null
    or cardinality(bucket.allowed_mime_types) <> cardinality(desired_mime_types)
    or not (bucket.allowed_mime_types @> desired_mime_types
      and bucket.allowed_mime_types <@ desired_mime_types) then
    raise exception using
      errcode = 'P0001',
      message = '0011 postcondition failed: existing course-covers bucket configuration does not match';
  end if;

  select string_agg(format('%I (%s)', policyname, cmd), ', ' order by policyname)
  into conflicting_policies
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    and roles && array['public', 'anon', 'authenticated']::name[];

  if conflicting_policies is not null then
    raise exception using
      errcode = 'P0001',
      message = '0011 postcondition failed: client Storage mutation policy detected',
      detail = conflicting_policies;
  end if;
end
$postconditions$;

commit;

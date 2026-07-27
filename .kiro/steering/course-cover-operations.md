# Course Cover Operations

This runbook covers the migration, audit, deployment, and retry boundaries for managed
course covers. It does not execute SQL or deploy functions.

## Target Verification

The reviewed project ref is `yqkvgfqplmbbcebrivpt`. Before every SQL or function
operation, verify the selected Supabase organization, project name, and ref in the
Dashboard. Stop if the ref differs. A matching URL copied from this document is not proof
that the Dashboard currently targets the intended project.

Do not run `supabase db push`. Remote migration-history reconciliation for the manually
applied migrations is still unproven. Never delete from `storage.objects` with SQL.

## Read-Only URL Audit

The following query classifies every course without returning raw URLs, query strings,
fragments, usernames, or passwords. `url_fingerprint` is a SHA-256 fingerprint for
joining audit results without exposing the source value. `authority` strips userinfo.

```sql
with inventory as (
  select
    id,
    imagen_url,
    case
      when imagen_url is null or btrim(imagen_url) = '' then 'no_cover'
      when imagen_url ~
        '^https://yqkvgfqplmbbcebrivpt\.supabase\.co/storage/v1/object/public/course-covers/sha256/[0-9a-f]{64}\.(jpg|png|webp)$'
        then 'managed_canonical'
      when imagen_url ~
        '^https://yqkvgfqplmbbcebrivpt\.supabase\.co/storage/v1/object/'
        then 'project_storage_noncanonical'
      else 'external_legacy'
    end as cover_class,
    case
      when imagen_url is null or btrim(imagen_url) = '' then null
      else encode(extensions.digest(convert_to(imagen_url, 'UTF8'), 'sha256'), 'hex')
    end as url_fingerprint,
    case
      when imagen_url ~ '^[a-zA-Z][a-zA-Z0-9+.-]*://' then lower(
        regexp_replace(
          substring(imagen_url from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#]*)'),
          '^.*@',
          ''
        )
      )
      else null
    end as authority
  from public.cursos
)
select id, cover_class, url_fingerprint, authority
from inventory
order by cover_class, id;
```

If `extensions.digest` is unavailable, stop and verify the installed `pgcrypto` schema;
do not create or move an extension as part of this read-only audit.

Summary counts:

```sql
with classified as (
  select case
    when imagen_url is null or btrim(imagen_url) = '' then 'no_cover'
    when imagen_url ~
      '^https://yqkvgfqplmbbcebrivpt\.supabase\.co/storage/v1/object/public/course-covers/sha256/[0-9a-f]{64}\.(jpg|png|webp)$'
      then 'managed_canonical'
    when imagen_url ~
      '^https://yqkvgfqplmbbcebrivpt\.supabase\.co/storage/v1/object/'
      then 'project_storage_noncanonical'
    else 'external_legacy'
  end as cover_class
  from public.cursos
)
select cover_class, count(*) as course_count
from classified
group by cover_class
order by cover_class;
```

## Canonical Backfill Preview

This preview mirrors migration `0012` and returns only course ID, URL fingerprint, and
the content-addressed path that would become managed. It does not update rows.

```sql
select
  id,
  encode(extensions.digest(convert_to(imagen_url, 'UTF8'), 'sha256'), 'hex')
    as url_fingerprint,
  substring(
    imagen_url from
    '^https://yqkvgfqplmbbcebrivpt\.supabase\.co/storage/v1/object/public/course-covers/(sha256/[0-9a-f]{64}\.(?:jpg|png|webp))$'
  ) as proposed_storage_path
from public.cursos
where imagen_url ~
  '^https://yqkvgfqplmbbcebrivpt\.supabase\.co/storage/v1/object/public/course-covers/sha256/[0-9a-f]{64}\.(?:jpg|png|webp)$'
order by id;
```

Review every `project_storage_noncanonical` row separately. Migration `0012` deliberately
does not normalize or delete it.

## Shared Managed Paths

Run this after `0012` or against the backfill preview CTE. A count above one is valid:
identical uploaded bytes intentionally share a content-addressed object.

```sql
select imagen_storage_path, count(*) as reference_count
from public.cursos
where imagen_storage_path is not null
group by imagen_storage_path
having count(*) > 1
order by reference_count desc, imagen_storage_path;
```

## Deployment Sequence

1. Verify project ref `yqkvgfqplmbbcebrivpt`, inspect the audit, and capture a database backup according to the project's normal Supabase process.
2. Apply `supabase/migrations/0012_secure_course_cover_cleanup.sql` as one complete transaction in the SQL Editor. Do not replay `0001`-`0011` and do not use `db push`.
3. Verify `imagen_storage_path`, the object/tombstone registry, upload intents, queue RLS/grants, triggers, and service-role-only RPC grants. Confirm `anon` and `authenticated` cannot read or execute lifecycle internals.
4. During this migration-first window, deployed/cached clients that write only a canonical managed URL remain compatible: the trigger derives the path and verifies the exact object in `storage.objects`. External URLs continue to derive no path. Do not treat this compatibility as permission to trust arbitrary browser paths.
5. Deploy `upload-course-cover` and `remove-course-cover` with platform JWT verification enabled. Preserve `SUPABASE_SERVICE_ROLE_KEY` only in function secrets.
6. Smoke-test admin auth, non-admin denial, canonical upload response (`url`, `path`, and association token), stale-pair conflict, cached URL-only association, external URL dissociation, managed removal, shared-path retention, replacement cleanup, and course-deletion cleanup.
7. Release browser assets only after both functions and `0012` are active.

No scheduler, log collector, or alert threshold is configured or claimed by this
repository. `remove-course-cover` first claims the path created by the explicit removal,
then processes older due backlog jobs separately, up to three total claims per authenticated
admin invocation. Its response distinguishes `deleted`, `queued`, `retained_shared`, and
`not_applicable`, includes only sanitized counters, and uses HTTP 202 with
`remove_cleanup_pending` whenever cleanup persistence/provider work remains uncertain.
Failed cleanup remains durable with bounded sanitized errors and backoff; a path in
`deleting` or `deleted` never becomes attachable through retry.

For an operational retry without a new visible cover removal, an authenticated admin may
invoke `remove-course-cover` for an existing course that currently has no cover, passing
that course ID and `{ "url": null, "path": null }` as the expected pair. The request still
passes origin, JWT, `getUser`, and `es_admin`; it does not require or accept a cleanup path.

## Queue Monitoring

There is no automatic collector. An operator must inspect the queue directly in the
verified target project. This aggregate query exposes no paths or course identifiers:

```sql
select
  status,
  count(*) as job_count,
  max(attempt_count) as max_attempt_count,
  extract(epoch from (clock_timestamp() - min(created_at)))::bigint as oldest_age_seconds,
  count(*) filter (where next_attempt_at <= clock_timestamp()) as due_count
from public.course_cover_cleanup_queue
group by status
order by status;
```

Check terminal and in-flight object states separately:

```sql
select state, count(*) as object_count
from public.course_cover_objects
group by state
order by state;
```

Review `retry` growth, old `processing` rows, and long-lived `deleting` states as explicit
operational work. No numeric alert threshold is asserted until a real collector exists.

## SQL Integration Test

Run only against an isolated disposable PostgreSQL database with the exact guarded name:

```bash
psql "postgresql://postgres:<password>@127.0.0.1:<port>/taudux_cover_0012_test" \
  -v ON_ERROR_STOP=1 \
  -f supabase/tests/0012_secure_course_cover_cleanup.test.sql
```

The script creates minimal Supabase-compatible `storage` fixtures, applies `0012`, and
executes grants, triggers, shared-reference, dissociation, claim-generation, stale-worker,
retry/tombstone, delayed-association, and concurrent-lock assertions. It deliberately
refuses every other database name. Local runtime remains unverified when `psql`/Docker is
not available; static Node tests are not a substitute for this execution.

## Rollback Boundary

For an application rollback, roll back browser assets first and then both Edge Functions;
leave migration `0012` installed. Its URL-only compatibility trigger permits the previous
upload client to keep writing canonical managed URLs without a path, while tombstones still
prevent resurrection.

Do not reverse `0012` with ad hoc `DROP` statements. A schema rollback requires a separate
reviewed forward migration after writes are paused, every upload intent is expired/drained,
the cleanup queue is empty, no object remains `deleting`, and all managed references have a
documented destination. Preserve tombstones until no cached client can replay an old URL.
Do not remove the bucket while any course references a managed path. Any Storage object
removal uses the Storage API, never SQL deletion from Storage-managed tables.

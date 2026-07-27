-- CRITICAL DEPLOYMENT PREFLIGHT
-- Verify the target project is yqkvgfqplmbbcebrivpt before running this file.
-- Migrations 0001-0011 were applied manually and their remote migration-history
-- correspondence is not proven. Do not use `supabase db push`; apply this complete
-- transaction only after reviewing the read-only audit in
-- `.kiro/steering/course-cover-operations.md`.
--
-- Migration-first rollout is supported: cached clients may write only the canonical
-- managed URL. The trigger derives its path and verifies the object server-side.
-- Deploy both Edge Functions with JWT verification enabled before browser assets.
-- No scheduler is installed by this change. Never delete from storage.objects directly.

begin;

do $preflight$
begin
  if to_regprocedure('public.es_admin()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0012 preflight failed: public.es_admin() is required';
  end if;

  if to_regclass('public.cursos') is null then
    raise exception using
      errcode = 'P0001',
      message = '0012 preflight failed: public.cursos is required';
  end if;

  if not exists (select 1 from storage.buckets where id = 'course-covers') then
    raise exception using
      errcode = 'P0001',
      message = '0012 preflight failed: course-covers bucket is required';
  end if;
end
$preflight$;

alter table public.cursos
  add column imagen_storage_path text,
  add column imagen_upload_token uuid;

create table public.course_cover_objects (
  storage_path text primary key,
  state text not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint course_cover_object_path_canonical
    check (storage_path ~ '^sha256/[0-9a-f]{64}\.(jpg|png|webp)$'),
  constraint course_cover_object_state_valid
    check (state in ('uploading', 'available', 'deleting', 'deleted')),
  constraint course_cover_object_deleted_at_consistent
    check ((state = 'deleted') = (deleted_at is not null))
);

create table public.course_cover_upload_intents (
  association_token uuid primary key default pg_catalog.gen_random_uuid(),
  storage_path text not null references public.course_cover_objects (storage_path) on delete cascade,
  status text not null default 'pending',
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_cover_upload_intent_status_valid
    check (status in ('pending', 'ready'))
);

create index course_cover_upload_intents_path_idx
  on public.course_cover_upload_intents (storage_path, expires_at);

create table public.course_cover_cleanup_queue (
  storage_path text primary key references public.course_cover_objects (storage_path),
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  claim_token uuid,
  claim_generation bigint not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_cover_cleanup_path_canonical
    check (storage_path ~ '^sha256/[0-9a-f]{64}\.(jpg|png|webp)$'),
  constraint course_cover_cleanup_status_valid
    check (status in ('pending', 'processing', 'retry')),
  constraint course_cover_cleanup_attempt_count_valid
    check (attempt_count >= 0),
  constraint course_cover_cleanup_generation_valid
    check (claim_generation >= 0),
  constraint course_cover_cleanup_claim_consistent
    check (
      (status = 'processing' and claimed_at is not null and claim_token is not null)
      or (status <> 'processing' and claimed_at is null and claim_token is null)
    ),
  constraint course_cover_cleanup_last_error_bounded
    check (last_error is null or char_length(last_error) <= 160)
);

alter table public.course_cover_objects enable row level security;
alter table public.course_cover_objects force row level security;
alter table public.course_cover_upload_intents enable row level security;
alter table public.course_cover_upload_intents force row level security;
alter table public.course_cover_cleanup_queue enable row level security;
alter table public.course_cover_cleanup_queue force row level security;

revoke all on table public.course_cover_objects from public, anon, authenticated;
revoke all on table public.course_cover_upload_intents from public, anon, authenticated;
revoke all on table public.course_cover_cleanup_queue from public, anon, authenticated;
grant select, insert, update, delete on table public.course_cover_objects to service_role;
grant select, insert, update, delete on table public.course_cover_upload_intents to service_role;
grant select, insert, update, delete on table public.course_cover_cleanup_queue to service_role;

-- Only exact URLs from this project, bucket, and content-addressed layout become
-- managed. Query strings, fragments, alternate hosts, and malformed paths stay external.
update public.cursos
set imagen_storage_path = substring(
  imagen_url from
  '^https://yqkvgfqplmbbcebrivpt\.supabase\.co/storage/v1/object/public/course-covers/(sha256/[0-9a-f]{64}\.(?:jpg|png|webp))$'
)
where imagen_url ~
  '^https://yqkvgfqplmbbcebrivpt\.supabase\.co/storage/v1/object/public/course-covers/sha256/[0-9a-f]{64}\.(?:jpg|png|webp)$';

insert into public.course_cover_objects (storage_path, state)
select distinct imagen_storage_path, 'available'
from public.cursos
where imagen_storage_path is not null;

alter table public.cursos
  add constraint cursos_imagen_storage_path_canonical
    check (
      imagen_storage_path is null
      or imagen_storage_path ~ '^sha256/[0-9a-f]{64}\.(jpg|png|webp)$'
    ),
  add constraint cursos_imagen_upload_token_transient
    check (imagen_upload_token is null),
  add constraint cursos_imagen_managed_pair_consistent
    check (
      (
        imagen_storage_path is null
        and (
          imagen_url is null
          or imagen_url !~
            '^https://yqkvgfqplmbbcebrivpt\.supabase\.co/storage/v1/object/public/course-covers/sha256/[0-9a-f]{64}\.(jpg|png|webp)$'
        )
      )
      or imagen_url =
        'https://yqkvgfqplmbbcebrivpt.supabase.co/storage/v1/object/public/course-covers/'
        || imagen_storage_path
    );

create index cursos_imagen_storage_path_idx
  on public.cursos (imagen_storage_path)
  where imagen_storage_path is not null;

create or replace function public.begin_course_cover_upload(upload_storage_path text)
returns table (association_token uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_state text;
begin
  if upload_storage_path !~ '^sha256/[0-9a-f]{64}\.(jpg|png|webp)$' then
    raise exception using errcode = '22023', message = 'invalid_course_cover_path';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('course-covers:' || upload_storage_path, 0)
  );

  delete from public.course_cover_upload_intents
  where storage_path = upload_storage_path
    and expires_at <= pg_catalog.clock_timestamp();

  update public.course_cover_objects as object
  set state = 'deleted',
      deleted_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where object.storage_path = upload_storage_path
    and object.state = 'uploading'
    and not exists (
      select 1 from public.course_cover_upload_intents as intent
      where intent.storage_path = upload_storage_path
    )
    and not exists (
      select 1 from public.cursos where imagen_storage_path = upload_storage_path
    );

  select object.state
  into current_state
  from public.course_cover_objects as object
  where object.storage_path = upload_storage_path
  for update;

  if current_state = 'deleting' then
    raise exception using errcode = '40001', message = 'cover_cleanup_in_progress';
  end if;

  if current_state is null then
    insert into public.course_cover_objects (storage_path, state)
    values (upload_storage_path, 'uploading');
  elsif current_state in ('uploading', 'deleted') then
    update public.course_cover_objects
    set state = 'uploading',
        deleted_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where storage_path = upload_storage_path;
  end if;

  insert into public.course_cover_upload_intents (storage_path)
  values (upload_storage_path)
  returning course_cover_upload_intents.association_token into association_token;

  return next;
end
$function$;

create or replace function public.complete_course_cover_upload(upload_association_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  intent_path text;
  changed integer;
begin
  select intent.storage_path
  into intent_path
  from public.course_cover_upload_intents as intent
  where intent.association_token = upload_association_token;

  if intent_path is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('course-covers:' || intent_path, 0)
  );

  update public.course_cover_upload_intents as intent
  set status = 'ready',
      updated_at = pg_catalog.clock_timestamp()
  where intent.association_token = upload_association_token
    and intent.status = 'pending'
    and intent.expires_at > pg_catalog.clock_timestamp()
    and not exists (
      select 1
      from public.course_cover_objects as object
      where object.storage_path = intent.storage_path
        and object.state = 'deleting'
    );

  get diagnostics changed = row_count;
  if changed <> 1 then
    return false;
  end if;

  update public.course_cover_objects
  set state = 'available',
      deleted_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where storage_path = intent_path;

  return true;
end
$function$;

create or replace function public.cancel_course_cover_upload(upload_association_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  intent_path text;
  changed integer;
begin
  select intent.storage_path
  into intent_path
  from public.course_cover_upload_intents as intent
  where intent.association_token = upload_association_token;

  if intent_path is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('course-covers:' || intent_path, 0)
  );

  delete from public.course_cover_upload_intents
  where association_token = upload_association_token
    and status = 'pending';
  get diagnostics changed = row_count;

  update public.course_cover_objects as object
  set state = 'deleted',
      deleted_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where object.storage_path = intent_path
    and object.state = 'uploading'
    and not exists (
      select 1 from public.course_cover_upload_intents as intent
      where intent.storage_path = intent_path
    )
    and not exists (
      select 1 from public.cursos where imagen_storage_path = intent_path
    );

  return changed = 1;
end
$function$;

create or replace function public.guard_course_cover_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  path_to_lock text;
  derived_path text;
  object_state text;
  token_valid boolean;
begin
  derived_path := substring(
    new.imagen_url from
    '^https://yqkvgfqplmbbcebrivpt\.supabase\.co/storage/v1/object/public/course-covers/(sha256/[0-9a-f]{64}\.(?:jpg|png|webp))$'
  );

  if derived_path is not null and (
    new.imagen_storage_path is null
    or (
      tg_op = 'UPDATE'
      and new.imagen_url is distinct from old.imagen_url
      and new.imagen_storage_path is not distinct from old.imagen_storage_path
    )
  ) then
    new.imagen_storage_path := derived_path;
  elsif derived_path is null
    and tg_op = 'UPDATE'
    and new.imagen_url is distinct from old.imagen_url
    and new.imagen_storage_path is not distinct from old.imagen_storage_path then
    new.imagen_storage_path := null;
  end if;

  if tg_op = 'UPDATE'
    and new.imagen_storage_path is not distinct from old.imagen_storage_path
    and new.imagen_upload_token is null then
    return new;
  end if;

  for path_to_lock in
    select distinct candidate
    from unnest(array[
      case when tg_op = 'UPDATE' then old.imagen_storage_path else null end,
      new.imagen_storage_path
    ]) as paths(candidate)
    where candidate is not null
    order by candidate
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('course-covers:' || path_to_lock, 0)
    );
  end loop;

  if new.imagen_storage_path is null then
    new.imagen_upload_token := null;
    return new;
  end if;

  select object.state
  into object_state
  from public.course_cover_objects as object
  where object.storage_path = new.imagen_storage_path
  for update;

  -- Cached pre-0012 upload clients cannot create an intent. Accept their pathless
  -- canonical URL only after verifying that Storage currently contains the exact object.
  if object_state is null and exists (
    select 1
    from storage.objects
    where bucket_id = 'course-covers'
      and name = new.imagen_storage_path
  ) then
    insert into public.course_cover_objects (storage_path, state)
    values (new.imagen_storage_path, 'available')
    returning state into object_state;
  end if;

  if object_state is distinct from 'available' then
    raise exception using errcode = '40001', message = 'cover_not_attachable';
  end if;

  if new.imagen_upload_token is not null then
    token_valid := false;
    select true
    into token_valid
    from public.course_cover_upload_intents as intent
    where intent.association_token = new.imagen_upload_token
      and intent.storage_path = new.imagen_storage_path
      and intent.status = 'ready'
      and intent.expires_at > pg_catalog.clock_timestamp()
    for update;

    if not token_valid then
      raise exception using errcode = '40001', message = 'cover_upload_intent_invalid';
    end if;

    delete from public.course_cover_upload_intents
    where association_token = new.imagen_upload_token;
  end if;

  -- A pending/retry cleanup still describes an existing object. The new reference
  -- wins under the same advisory lock; deleting/deleted objects were rejected above.
  delete from public.course_cover_cleanup_queue
  where storage_path = new.imagen_storage_path
    and status in ('pending', 'retry');

  new.imagen_upload_token := null;
  return new;
end
$function$;

create or replace function public.enqueue_unreferenced_course_cover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous_path text := old.imagen_storage_path;
begin
  if previous_path is null then
    return null;
  end if;

  if tg_op = 'UPDATE'
    and new.imagen_storage_path is not distinct from previous_path then
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('course-covers:' || previous_path, 0)
  );

  if exists (
    select 1 from public.cursos where imagen_storage_path = previous_path
  ) then
    return null;
  end if;

  insert into public.course_cover_objects (storage_path, state)
  values (previous_path, 'available')
  on conflict (storage_path) do nothing;

  insert into public.course_cover_cleanup_queue (
    storage_path, status, attempt_count, next_attempt_at, claimed_at,
    claim_token, last_error, updated_at
  ) values (
    previous_path, 'pending', 0, pg_catalog.clock_timestamp(), null,
    null, null, pg_catalog.clock_timestamp()
  )
  on conflict (storage_path) do update
  set status = 'pending',
      attempt_count = 0,
      next_attempt_at = excluded.next_attempt_at,
      claimed_at = null,
      claim_token = null,
      last_error = null,
      updated_at = excluded.updated_at;

  return null;
end
$function$;

create trigger cursos_guard_cover_reference
  before insert or update of imagen_url, imagen_storage_path, imagen_upload_token on public.cursos
  for each row execute function public.guard_course_cover_reference();

create trigger cursos_enqueue_cover_cleanup
  after update of imagen_storage_path or delete on public.cursos
  for each row execute function public.enqueue_unreferenced_course_cover();

create or replace function public.remove_course_cover(
  course_id uuid,
  expected_url text,
  expected_storage_path text
)
returns table (result text, cleanup_storage_path text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_url text;
  current_path text;
begin
  select cursos.imagen_url, cursos.imagen_storage_path
  into current_url, current_path
  from public.cursos
  where cursos.id = course_id
  for update;

  if not found then
    return query select 'not_found'::text, null::text;
    return;
  end if;

  if current_url is distinct from expected_url
    or current_path is distinct from expected_storage_path then
    return query select 'cover_conflict'::text, null::text;
    return;
  end if;

  if current_url is null and current_path is null then
    return query select 'no_cover'::text, null::text;
    return;
  end if;

  update public.cursos
  set imagen_url = null,
      imagen_storage_path = null,
      imagen_upload_token = null
  where id = course_id;

  return query select 'removed'::text, current_path;
end
$function$;

create or replace function public.claim_course_cover_cleanup(preferred_storage_path text default null)
returns table (
  storage_path text,
  attempt_count integer,
  claim_token uuid,
  claim_generation bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate text;
  next_token uuid;
  next_generation bigint;
begin
  if preferred_storage_path is not null
    and preferred_storage_path !~ '^sha256/[0-9a-f]{64}\.(jpg|png|webp)$' then
    return;
  end if;

  loop
    candidate := null;
    select queue.storage_path
    into candidate
    from public.course_cover_cleanup_queue as queue
    where (preferred_storage_path is null or queue.storage_path = preferred_storage_path)
      and (
        (queue.status in ('pending', 'retry') and (
          preferred_storage_path is not null
          or queue.next_attempt_at <= pg_catalog.clock_timestamp()
        ))
        or (
          queue.status = 'processing'
          and queue.claimed_at <= pg_catalog.clock_timestamp() - interval '5 minutes'
        )
      )
    order by
      case when queue.storage_path = preferred_storage_path then 0 else 1 end,
      queue.next_attempt_at,
      queue.created_at,
      queue.storage_path
    limit 1
    for update skip locked;

    if candidate is null then
      return;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('course-covers:' || candidate, 0)
    );

    if exists (select 1 from public.cursos where imagen_storage_path = candidate) then
      delete from public.course_cover_cleanup_queue where storage_path = candidate;
      update public.course_cover_objects
      set state = 'available', deleted_at = null, updated_at = pg_catalog.clock_timestamp()
      where course_cover_objects.storage_path = candidate;
      if preferred_storage_path is not null then return; end if;
      continue;
    end if;

    if exists (
      select 1
      from public.course_cover_upload_intents as intent
      where intent.storage_path = candidate
        and intent.expires_at > pg_catalog.clock_timestamp()
    ) then
      if preferred_storage_path is not null then return; end if;
      update public.course_cover_cleanup_queue
      set next_attempt_at = pg_catalog.clock_timestamp() + interval '30 seconds',
          updated_at = pg_catalog.clock_timestamp()
      where course_cover_cleanup_queue.storage_path = candidate;
      continue;
    end if;

    next_token := pg_catalog.gen_random_uuid();
    update public.course_cover_cleanup_queue as queue
    set status = 'processing',
        attempt_count = queue.attempt_count + 1,
        claimed_at = pg_catalog.clock_timestamp(),
        claim_token = next_token,
        claim_generation = queue.claim_generation + 1,
        updated_at = pg_catalog.clock_timestamp()
    where queue.storage_path = candidate
    returning queue.attempt_count, queue.claim_generation
      into attempt_count, next_generation;

    update public.course_cover_objects
    set state = 'deleting',
        deleted_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where course_cover_objects.storage_path = candidate;

    storage_path := candidate;
    claim_token := next_token;
    claim_generation := next_generation;
    return next;
    return;
  end loop;
end
$function$;

create or replace function public.retry_course_cover_cleanup(
  cleanup_storage_path text,
  cleanup_claim_token uuid,
  cleanup_claim_generation bigint,
  sanitized_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed integer;
begin
  if cleanup_storage_path !~ '^sha256/[0-9a-f]{64}\.(jpg|png|webp)$'
    or cleanup_claim_token is null
    or cleanup_claim_generation is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('course-covers:' || cleanup_storage_path, 0)
  );

  update public.course_cover_cleanup_queue as queue
  set status = 'retry',
      next_attempt_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(
          secs => least(3600, 30 * power(2, least(queue.attempt_count, 7)))::integer
        ),
      claimed_at = null,
      claim_token = null,
      last_error = left(coalesce(sanitized_error, 'cleanup_failed'), 160),
      updated_at = pg_catalog.clock_timestamp()
  where queue.storage_path = cleanup_storage_path
    and queue.status = 'processing'
    and queue.claim_token = cleanup_claim_token
    and queue.claim_generation = cleanup_claim_generation;

  get diagnostics changed = row_count;
  -- `deleting` is deliberately retained. A provider failure may be ambiguous and a
  -- completion response may be lost after deletion; neither case may reopen attachment.
  return changed = 1;
end
$function$;

create or replace function public.complete_course_cover_cleanup(
  cleanup_storage_path text,
  cleanup_claim_token uuid,
  cleanup_claim_generation bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  owned boolean;
begin
  if cleanup_storage_path !~ '^sha256/[0-9a-f]{64}\.(jpg|png|webp)$'
    or cleanup_claim_token is null
    or cleanup_claim_generation is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('course-covers:' || cleanup_storage_path, 0)
  );

  select true
  into owned
  from public.course_cover_cleanup_queue as queue
  where queue.storage_path = cleanup_storage_path
    and queue.status = 'processing'
    and queue.claim_token = cleanup_claim_token
    and queue.claim_generation = cleanup_claim_generation
  for update;

  if owned is distinct from true or exists (
    select 1 from public.cursos where imagen_storage_path = cleanup_storage_path
  ) then
    return false;
  end if;

  update public.course_cover_objects
  set state = 'deleted',
      deleted_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where storage_path = cleanup_storage_path;

  delete from public.course_cover_cleanup_queue
  where storage_path = cleanup_storage_path
    and status = 'processing'
    and claim_token = cleanup_claim_token
    and claim_generation = cleanup_claim_generation;

  return found;
end
$function$;

create or replace function public.course_cover_cleanup_status(cleanup_storage_path text)
returns table (status text)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if cleanup_storage_path !~ '^sha256/[0-9a-f]{64}\.(jpg|png|webp)$' then
    return query select 'not_applicable'::text;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('course-covers:' || cleanup_storage_path, 0)
  );

  if exists (select 1 from public.cursos where imagen_storage_path = cleanup_storage_path) then
    return query select 'retained_shared'::text;
  elsif exists (
    select 1 from public.course_cover_objects
    where course_cover_objects.storage_path = cleanup_storage_path and state = 'deleted'
  ) then
    return query select 'deleted'::text;
  elsif exists (
    select 1 from public.course_cover_cleanup_queue
    where course_cover_cleanup_queue.storage_path = cleanup_storage_path
  ) or exists (
    select 1 from public.course_cover_objects
    where course_cover_objects.storage_path = cleanup_storage_path and state = 'deleting'
  ) then
    return query select 'queued'::text;
  else
    return query select 'not_queued'::text;
  end if;
end
$function$;

revoke all on function public.begin_course_cover_upload(text) from public, anon, authenticated;
revoke all on function public.complete_course_cover_upload(uuid) from public, anon, authenticated;
revoke all on function public.cancel_course_cover_upload(uuid) from public, anon, authenticated;
revoke all on function public.guard_course_cover_reference() from public, anon, authenticated;
revoke all on function public.enqueue_unreferenced_course_cover() from public, anon, authenticated;
revoke all on function public.remove_course_cover(uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_course_cover_cleanup(text) from public, anon, authenticated;
revoke all on function public.retry_course_cover_cleanup(text, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.complete_course_cover_cleanup(text, uuid, bigint) from public, anon, authenticated;
revoke all on function public.course_cover_cleanup_status(text) from public, anon, authenticated;

grant execute on function public.begin_course_cover_upload(text) to service_role;
grant execute on function public.complete_course_cover_upload(uuid) to service_role;
grant execute on function public.cancel_course_cover_upload(uuid) to service_role;
grant execute on function public.remove_course_cover(uuid, text, text) to service_role;
grant execute on function public.claim_course_cover_cleanup(text) to service_role;
grant execute on function public.retry_course_cover_cleanup(text, uuid, bigint, text) to service_role;
grant execute on function public.complete_course_cover_cleanup(text, uuid, bigint) to service_role;
grant execute on function public.course_cover_cleanup_status(text) to service_role;

commit;

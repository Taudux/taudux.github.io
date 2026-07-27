\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_cover_0012_test' then
    raise exception 'Refusing to run outside taudux_cover_0012_test';
  end if;
end
$guard$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$roles$;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  bucket_id text not null,
  name text not null,
  unique (bucket_id, name)
);
insert into storage.buckets (id, name, public)
values ('course-covers', 'course-covers', true);

create table public.cursos (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  imagen_url text
);
create function public.es_admin()
returns boolean language sql stable as $$ select true $$;

insert into public.cursos (id, imagen_url) values
  (
    '10000000-0000-4000-8000-000000000001',
    'https://yqkvgfqplmbbcebrivpt.supabase.co/storage/v1/object/public/course-covers/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'
  ),
  ('10000000-0000-4000-8000-000000000002', 'https://external.example/cover.jpg');

\ir ../migrations/0012_secure_course_cover_cleanup.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

select pg_temp.assert_true(
  (select imagen_storage_path = 'sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'
   from public.cursos where id = '10000000-0000-4000-8000-000000000001'),
  'canonical URL backfill derives the managed path'
);
select pg_temp.assert_true(
  (select imagen_storage_path is null
   from public.cursos where id = '10000000-0000-4000-8000-000000000002'),
  'external URLs remain path-null'
);
create temp table external_removal as
select * from public.remove_course_cover(
  '10000000-0000-4000-8000-000000000002',
  'https://external.example/cover.jpg',
  null
);
select pg_temp.assert_true(
  (select result = 'removed' and cleanup_storage_path is null from external_removal),
  'external URL dissociation never yields a Storage cleanup path'
);
select pg_temp.assert_true(
  (select count(*) = 2 from pg_trigger
   where tgrelid = 'public.cursos'::regclass and not tgisinternal
     and tgname in ('cursos_guard_cover_reference', 'cursos_enqueue_cover_cleanup')),
  'both lifecycle triggers exist'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.course_cover_cleanup_queue', 'select')
    and not has_table_privilege('authenticated', 'public.course_cover_cleanup_queue', 'select')
    and has_table_privilege('service_role', 'public.course_cover_cleanup_queue', 'select'),
  'cleanup table grants fail closed'
);
select pg_temp.assert_true(
  not has_function_privilege('authenticated', 'public.claim_course_cover_cleanup(text)', 'execute')
    and has_function_privilege('service_role', 'public.claim_course_cover_cleanup(text)', 'execute'),
  'cleanup RPC grants are service-role only'
);

-- Cached migration-first clients send only a canonical URL. Storage existence is the
-- server-side proof; two references to one SHA object are valid.
insert into storage.objects (bucket_id, name) values
  ('course-covers', 'sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp');
insert into public.cursos (id, imagen_url) values
  (
    '20000000-0000-4000-8000-000000000001',
    'https://yqkvgfqplmbbcebrivpt.supabase.co/storage/v1/object/public/course-covers/sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'https://yqkvgfqplmbbcebrivpt.supabase.co/storage/v1/object/public/course-covers/sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp'
  );
delete from public.cursos where id = '20000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(
  not exists (select 1 from public.course_cover_cleanup_queue
              where storage_path = 'sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp'),
  'shared path is not queued while one reference remains'
);
delete from public.cursos where id = '20000000-0000-4000-8000-000000000002';
select pg_temp.assert_true(
  exists (select 1 from public.course_cover_cleanup_queue
          where storage_path = 'sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp'),
  'last dissociation queues cleanup'
);

create temp table first_claim as
select * from public.claim_course_cover_cleanup(
  'sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp'
);
select pg_temp.assert_true(
  (select count(*) = 1 and min(claim_generation) = 1 from first_claim),
  'first claim returns one generation-owned job'
);
update public.course_cover_cleanup_queue
set claimed_at = pg_catalog.clock_timestamp() - interval '6 minutes'
where storage_path = 'sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp';
create temp table second_claim as
select * from public.claim_course_cover_cleanup(
  'sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp'
);
select pg_temp.assert_true(
  (select second.claim_generation = first.claim_generation + 1
          and second.claim_token <> first.claim_token
   from first_claim as first cross join second_claim as second),
  'expired claim receives a new unforgeable token and generation'
);
select pg_temp.assert_true(
  not public.retry_course_cover_cleanup(
    (select storage_path from first_claim),
    (select claim_token from first_claim),
    (select claim_generation from first_claim),
    'stale_worker'
  ),
  'stale worker cannot retry a newer claim'
);
select pg_temp.assert_true(
  not public.complete_course_cover_cleanup(
    (select storage_path from first_claim),
    (select claim_token from first_claim),
    (select claim_generation from first_claim)
  ),
  'stale worker cannot complete a newer claim'
);
select pg_temp.assert_true(
  public.retry_course_cover_cleanup(
    (select storage_path from second_claim),
    (select claim_token from second_claim),
    (select claim_generation from second_claim),
    'completion_persistence_unknown_after_delete'
  ),
  'current owner can durably retry'
);
select pg_temp.assert_true(
  (select state = 'deleting' from public.course_cover_objects
   where storage_path = 'sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp'),
  'retry never reopens an ambiguously deleted object'
);
do $blocked_retry$
begin
  begin
    insert into public.cursos (id, imagen_url) values (
      '20000000-0000-4000-8000-000000000003',
      'https://yqkvgfqplmbbcebrivpt.supabase.co/storage/v1/object/public/course-covers/sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp'
    );
    raise exception 'deleting path was attached';
  exception when serialization_failure then
    null;
  end;
end
$blocked_retry$;
create temp table final_claim as
select * from public.claim_course_cover_cleanup(
  'sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp'
);
select pg_temp.assert_true(
  public.complete_course_cover_cleanup(
    (select storage_path from final_claim),
    (select claim_token from final_claim),
    (select claim_generation from final_claim)
  ),
  'current owner completes cleanup'
);
select pg_temp.assert_true(
  (select state = 'deleted' and deleted_at is not null from public.course_cover_objects
   where storage_path = 'sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp'),
  'completion leaves a durable tombstone'
);

-- Upload intent blocks cleanup until association or expiry. After expiry and claim,
-- delayed association is rejected and completion leaves the path tombstoned.
create temp table upload_intent as
select * from public.begin_course_cover_upload(
  'sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.jpg'
);
insert into storage.objects (bucket_id, name) values
  ('course-covers', 'sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.jpg');
select pg_temp.assert_true(
  public.complete_course_cover_upload((select association_token from upload_intent)),
  'Storage success finalizes the upload intent'
);
insert into public.cursos (id, imagen_url, imagen_storage_path, imagen_upload_token) values (
  '30000000-0000-4000-8000-000000000001',
  'https://yqkvgfqplmbbcebrivpt.supabase.co/storage/v1/object/public/course-covers/sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.jpg',
  'sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.jpg',
  (select association_token from upload_intent)
);
select pg_temp.assert_true(
  (select imagen_upload_token is null from public.cursos
   where id = '30000000-0000-4000-8000-000000000001'),
  'association token is consumed and never persisted'
);
create temp table removal_result as
select * from public.remove_course_cover(
  '30000000-0000-4000-8000-000000000001',
  'https://yqkvgfqplmbbcebrivpt.supabase.co/storage/v1/object/public/course-covers/sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.jpg',
  'sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.jpg'
);
select pg_temp.assert_true(
  (select result = 'removed'
          and cleanup_storage_path = 'sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.jpg'
   from removal_result),
  'dissociation returns its own managed cleanup path'
);
create temp table delayed_intent as
select * from public.begin_course_cover_upload(
  'sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.jpg'
);
select pg_temp.assert_true(
  public.complete_course_cover_upload((select association_token from delayed_intent)),
  'second upload is ready before delayed association'
);
select pg_temp.assert_true(
  not exists (select 1 from public.claim_course_cover_cleanup(
    'sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.jpg'
  )),
  'ready upload intent blocks cleanup claim'
);
update public.course_cover_upload_intents
set expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where association_token = (select association_token from delayed_intent);
create temp table delayed_claim as
select * from public.claim_course_cover_cleanup(
  'sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.jpg'
);
do $blocked_delayed_association$
begin
  begin
    insert into public.cursos (id, imagen_url, imagen_storage_path, imagen_upload_token) values (
      '30000000-0000-4000-8000-000000000002',
      'https://yqkvgfqplmbbcebrivpt.supabase.co/storage/v1/object/public/course-covers/sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.jpg',
      'sha256/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.jpg',
      (select association_token from delayed_intent)
    );
    raise exception 'delayed association was accepted after cleanup claim';
  exception when serialization_failure then
    null;
  end;
end
$blocked_delayed_association$;
select pg_temp.assert_true(
  public.complete_course_cover_cleanup(
    (select storage_path from delayed_claim),
    (select claim_token from delayed_claim),
    (select claim_generation from delayed_claim)
  ),
  'claimed delayed upload is tombstoned after Storage deletion'
);

-- Deterministic concurrency: an uncommitted association owns the queue row. SKIP LOCKED
-- prevents another worker from claiming it; rollback restores the job for a later claim.
create extension dblink;
insert into storage.objects (bucket_id, name) values
  ('course-covers', 'sha256/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd.png');
insert into public.cursos (id, imagen_url) values (
  '40000000-0000-4000-8000-000000000001',
  'https://yqkvgfqplmbbcebrivpt.supabase.co/storage/v1/object/public/course-covers/sha256/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd.png'
);
delete from public.cursos where id = '40000000-0000-4000-8000-000000000001';
select dblink_connect(
  'association',
  'host=127.0.0.1 port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user
);
select dblink_exec('association', 'begin');
select dblink_exec(
  'association',
  $$insert into public.cursos (id, imagen_url) values (
    '40000000-0000-4000-8000-000000000002',
    'https://yqkvgfqplmbbcebrivpt.supabase.co/storage/v1/object/public/course-covers/sha256/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd.png'
  )$$
);
select pg_temp.assert_true(
  not exists (select 1 from public.claim_course_cover_cleanup(
    'sha256/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd.png'
  )),
  'concurrent worker cannot claim a queue row locked by association'
);
select dblink_exec('association', 'rollback');
create temp table concurrency_claim as
select * from public.claim_course_cover_cleanup(
  'sha256/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd.png'
);
select pg_temp.assert_true(
  (select count(*) = 1 from concurrency_claim),
  'rolled-back association leaves cleanup claimable'
);
select dblink_disconnect('association');

select '0012 secure course-cover integration: PASS' as result;

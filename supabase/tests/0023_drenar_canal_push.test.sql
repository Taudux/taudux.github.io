\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_drenar_push_0023_test' then
    raise exception 'Refusing to run outside taudux_drenar_push_0023_test';
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

create schema auth;
create table auth.users (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  deleted_at timestamptz
);

create table public.cursos (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  titulo text not null,
  estado text not null default 'publicado'
);

-- 0021's RLS policies are written against auth.uid(), which in Supabase reads
-- the per-request JWT claim. Stubbing it keeps those policies loadable here.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  rol text not null default 'usuario'
);

create function public.es_admin()
returns boolean language sql stable as $$
  select coalesce(current_setting('taudux.test_is_admin', true), 'true')::boolean;
$$;

\ir ../migrations/0015_avisos_curso_nuevo.sql
\ir ../migrations/0016_completar_anuncio_libera_claim.sql
\ir ../migrations/0018_republicar_reanuncia.sql
\ir ../migrations/0021_push_devices.sql
\ir ../migrations/0022_anuncios_canal_push.sql
\ir ../migrations/0023_drenar_canal_push.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

-- Four subscribers, deliberately varied so pagination has something to trip on:
--   user 1 -> two devices   (the multi-device case)
--   user 2 -> no device     (installed the web only; the left join keeps it)
--   user 3 -> one device
--   user 4 -> one device, but unsubscribed from course notices
insert into auth.users (id, email, email_confirmed_at) values
  ('40000000-0000-4000-8000-000000000001', 'uno@example.com', now()),
  ('40000000-0000-4000-8000-000000000002', 'dos@example.com', now()),
  ('40000000-0000-4000-8000-000000000003', 'tres@example.com', now()),
  ('40000000-0000-4000-8000-000000000004', 'cuatro@example.com', now());

-- In production a trigger from 0001 creates the profile alongside the user;
-- this harness builds public.perfiles by hand, so the rows go in explicitly.
insert into public.perfiles (id, rol, avisos_curso_nuevo) values
  ('40000000-0000-4000-8000-000000000001', 'usuario', true),
  ('40000000-0000-4000-8000-000000000002', 'usuario', true),
  ('40000000-0000-4000-8000-000000000003', 'usuario', true),
  ('40000000-0000-4000-8000-000000000004', 'usuario', false);

insert into public.push_devices (user_id, expo_push_token, platform) values
  ('40000000-0000-4000-8000-000000000001', 'ExponentPushToken[uno-telefono]', 'android'),
  ('40000000-0000-4000-8000-000000000001', 'ExponentPushToken[uno-tablet]', 'android'),
  ('40000000-0000-4000-8000-000000000003', 'ExponentPushToken[tres-telefono]', 'android'),
  ('40000000-0000-4000-8000-000000000004', 'ExponentPushToken[cuatro-telefono]', 'android');

-- 1. A user with two devices yields both tokens, and a user with none still
--    yields exactly one row with a null token. That null is what keeps
--    "length < limite means last page" true for the caller.
select pg_temp.assert_true(
  (select count(*) = 2 from public.destinatarios_push_curso_anuncio(null, 100)
   where id = '40000000-0000-4000-8000-000000000001'),
  'a user with two devices yields two rows'
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.destinatarios_push_curso_anuncio(null, 100)
   where id = '40000000-0000-4000-8000-000000000002'),
  'a user with no device still yields exactly one row'
);

select pg_temp.assert_true(
  (select expo_push_token is null from public.destinatarios_push_curso_anuncio(null, 100)
   where id = '40000000-0000-4000-8000-000000000002'),
  'the row for a user with no device carries a null token'
);

-- 2. Unsubscribed users never appear, device or not. Same guard as the email
--    channel: avisos_curso_nuevo governs both.
select pg_temp.assert_true(
  not exists (
    select 1 from public.destinatarios_push_curso_anuncio(null, 100)
    where id = '40000000-0000-4000-8000-000000000004'
  ),
  'an unsubscribed user is excluded even when it has a device'
);

-- 3. THE POINT OF THE CTE: limite counts USERS, not rows. Asking for 1 must
--    return user 1 whole -- both of its devices -- and stop there. A naive
--    "limit on the joined rows" would hand back one device and silently strip
--    the other, which no later page would ever revisit.
select pg_temp.assert_true(
  (select count(*) = 2 from public.destinatarios_push_curso_anuncio(null, 1)),
  'limite = 1 returns every device of the first user, not a single row'
);

select pg_temp.assert_true(
  (select bool_and(id = '40000000-0000-4000-8000-000000000001')
   from public.destinatarios_push_curso_anuncio(null, 1)),
  'limite = 1 returns only the first user'
);

-- 4. The cursor is the last user SCANNED. Paging from user 1 lands on 2 and 3,
--    and skips 4 because it is unsubscribed.
select pg_temp.assert_true(
  (select count(*) = 2
   from public.destinatarios_push_curso_anuncio('40000000-0000-4000-8000-000000000001', 100)),
  'paging past user 1 yields user 2 (null token) and user 3 (one device)'
);

-- 5. Ordering is stable by user id, so the caller's cursor never goes backwards.
select pg_temp.assert_true(
  (select bool_and(ordenado)
   from (
     select id >= lag(id) over (order by (select 1)) is not false as ordenado
     from public.destinatarios_push_curso_anuncio(null, 100)
   ) filas),
  'rows come back ordered by user id'
);

-- 6. Grants mirror destinatarios_curso_anuncio: service_role only. The drain
--    worker is the sole caller; a logged-in user must not be able to enumerate
--    every push token in the project.
select pg_temp.assert_true(
  not has_function_privilege(
    'authenticated',
    'public.destinatarios_push_curso_anuncio(uuid, integer)',
    'execute'
  ),
  'authenticated cannot execute destinatarios_push_curso_anuncio'
);

select pg_temp.assert_true(
  not has_function_privilege(
    'anon',
    'public.destinatarios_push_curso_anuncio(uuid, integer)',
    'execute'
  ),
  'anon cannot execute destinatarios_push_curso_anuncio'
);

select pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.destinatarios_push_curso_anuncio(uuid, integer)',
    'execute'
  ),
  'service_role can execute destinatarios_push_curso_anuncio'
);

-- 7. THE OTHER HALF OF 0023: claim_curso_anuncio stops being email-only.
--    Publishing a course enqueues one row per channel; draining twice must
--    hand back one of each, never the same channel twice.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000020', 'Curso que drena por ambos canales', 'publicado');

select pg_temp.assert_true(
  (select count(*) = 2 from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000020' and status = 'pending'),
  'publishing enqueues one pending row per channel'
);

-- next_attempt_at defaults to now() + 10 minutes: a deliberate grace window so
-- an admin can unpublish a course before the notice goes out. Bring both rows
-- forward so the claim can see them, same idiom as the 0022 harness.
update public.curso_anuncios
set next_attempt_at = now() - interval '1 minute'
where curso_id = '20000000-0000-4000-8000-000000000020';

create temporary table reclamos as
select canal from public.claim_curso_anuncio();
insert into reclamos select canal from public.claim_curso_anuncio();

select pg_temp.assert_true(
  (select count(*) = 2 from reclamos),
  'two claims return two rows now that push is drainable'
);

select pg_temp.assert_true(
  (select count(distinct canal) = 2 from reclamos),
  'the two claims cover both channels, not the same one twice'
);

select pg_temp.assert_true(
  (select bool_and(canal in ('email', 'push')) from reclamos),
  'claimed channels are exactly email and push'
);

select '0023 drenar canal push: PASS' as result;

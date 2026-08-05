\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_push_instalacion_0025_test' then
    raise exception 'Refusing to run outside taudux_push_instalacion_0025_test';
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

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  rol text not null default 'usuario'
);

insert into auth.users (id, email, email_confirmed_at) values
  ('60000000-0000-4000-8000-000000000001', 'uno@example.com', now()),
  ('60000000-0000-4000-8000-000000000002', 'dos@example.com', now());
insert into public.perfiles (id) values
  ('60000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002');

\ir ../migrations/0021_push_devices.sql

-- Una fila registrada con el esquema viejo, para comprobar que 0025 la borra en
-- vez de dejarla huérfana sin installation_id.
insert into public.push_devices (user_id, expo_push_token, platform) values
  ('60000000-0000-4000-8000-000000000001', 'ExponentPushToken[viejo]', 'android');

\ir ../migrations/0025_push_devices_instalacion.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

-- 1. La identidad de la fila pasa a ser el dispositivo, no el token.
select pg_temp.assert_true(
  (select string_agg(a.attname, ', ' order by k.ord) = 'user_id, installation_id'
     from pg_constraint c
     join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = 'public.push_devices'::regclass
      and c.contype = 'p'),
  'the primary key is (user_id, installation_id)'
);

-- 2. Las filas del esquema viejo se van: no hay forma de inventarles un
--    installation_id correcto, y dejarlas con uno al azar las volvería
--    huérfanas apenas la app registre el suyo.
select pg_temp.assert_true(
  (select count(*) = 0 from public.push_devices),
  'rows from the old token-identified schema are dropped'
);

-- 3. EL PUNTO DE 0025: rotar el token del mismo dispositivo ACTUALIZA la fila.
--    Antes cada rotación dejaba una fila más y el usuario recibía una
--    notificación por cada token vivo -- se observaron 3 del mismo teléfono.
insert into public.push_devices (user_id, installation_id, expo_push_token, platform)
values (
  '60000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-0000000000aa',
  'ExponentPushToken[primero]',
  'android'
)
on conflict (user_id, installation_id) do update
  set expo_push_token = excluded.expo_push_token,
      updated_at = now();

insert into public.push_devices (user_id, installation_id, expo_push_token, platform)
values (
  '60000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-0000000000aa',
  'ExponentPushToken[rotado]',
  'android'
)
on conflict (user_id, installation_id) do update
  set expo_push_token = excluded.expo_push_token,
      updated_at = now();

select pg_temp.assert_true(
  (select count(*) = 1 from public.push_devices
   where user_id = '60000000-0000-4000-8000-000000000001'),
  'rotating the token of one installation updates its row instead of adding another'
);

select pg_temp.assert_true(
  (select expo_push_token = 'ExponentPushToken[rotado]' from public.push_devices
   where user_id = '60000000-0000-4000-8000-000000000001'),
  'the surviving row carries the newest token'
);

-- 4. Teléfono Y tablet del mismo usuario conviven: son instalaciones distintas.
insert into public.push_devices (user_id, installation_id, expo_push_token, platform)
values (
  '60000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-0000000000bb',
  'ExponentPushToken[tablet]',
  'android'
);

select pg_temp.assert_true(
  (select count(*) = 2 from public.push_devices
   where user_id = '60000000-0000-4000-8000-000000000001'),
  'two installations of the same user coexist'
);

-- 5. RLS: sigue siendo por usuario, el cambio de PK no la aflojó.
insert into public.push_devices (user_id, installation_id, expo_push_token, platform)
values (
  '60000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-0000000000cc',
  'ExponentPushToken[del-otro]',
  'android'
);

set role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', false);

select pg_temp.assert_true(
  not exists (
    select 1 from public.push_devices
    where user_id = '60000000-0000-4000-8000-000000000002'
  ),
  'a user cannot select another user''s device rows'
);

update public.push_devices
set expo_push_token = 'ExponentPushToken[hijack]'
where user_id = '60000000-0000-4000-8000-000000000002';

reset role;
select pg_temp.assert_true(
  (select expo_push_token = 'ExponentPushToken[del-otro]' from public.push_devices
   where user_id = '60000000-0000-4000-8000-000000000002'),
  'a user cannot update another user''s device row'
);

select pg_temp.assert_true(
  (select count(*) = 2 from public.push_devices
   where user_id = '60000000-0000-4000-8000-000000000001'),
  'the caller still sees exactly its own two installations'
);

select '0025 push devices instalacion: PASS' as result;

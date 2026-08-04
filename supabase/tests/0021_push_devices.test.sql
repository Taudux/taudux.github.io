\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_push_devices_0021_test' then
    raise exception 'Refusing to run outside taudux_push_devices_0021_test';
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

-- Minimal stand-in for Supabase's real auth.uid(): reads the same GUC
-- (request.jwt.claim.sub) PostgREST sets per request, so policies written
-- against auth.uid() exercise the real RLS path under `set role`.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  rol text not null default 'usuario'
);

insert into auth.users (id, email, email_confirmed_at, deleted_at) values
  ('30000000-0000-4000-8000-000000000001', 'a@example.com', now(), null),
  ('30000000-0000-4000-8000-000000000002', 'b@example.com', now(), null);
insert into public.perfiles (id, rol) values
  ('30000000-0000-4000-8000-000000000001', 'usuario'),
  ('30000000-0000-4000-8000-000000000002', 'usuario');

\ir ../migrations/0021_push_devices.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

-- 1. Table shape: expected columns exist with the right nullability.
select pg_temp.assert_true(
  (select count(*) = 5 from information_schema.columns
   where table_schema = 'public' and table_name = 'push_devices'
     and column_name in ('user_id', 'expo_push_token', 'platform', 'created_at', 'updated_at')),
  'push_devices has the five expected columns'
);
select pg_temp.assert_true(
  (select is_nullable = 'NO' from information_schema.columns
   where table_schema = 'public' and table_name = 'push_devices'
     and column_name = 'expo_push_token'),
  'expo_push_token is not nullable'
);
select pg_temp.assert_true(
  (select is_nullable = 'YES' from information_schema.columns
   where table_schema = 'public' and table_name = 'push_devices'
     and column_name = 'platform'),
  'platform is nullable'
);

-- 2. RLS is enabled and forced.
select pg_temp.assert_true(
  (select relrowsecurity and relforcerowsecurity
   from pg_class
   where oid = 'public.push_devices'::regclass),
  'push_devices has RLS enabled and forced'
);

-- 3. anon has no privileges at all.
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.push_devices', 'select')
    and not has_table_privilege('anon', 'public.push_devices', 'insert')
    and not has_table_privilege('anon', 'public.push_devices', 'update')
    and not has_table_privilege('anon', 'public.push_devices', 'delete'),
  'anon has no privileges on push_devices'
);

-- Impersonate user 1 the way PostgREST does: SET ROLE authenticated plus the
-- request.jwt.claim.sub GUC that auth.uid() reads.
set role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', false);

-- 4. A user can insert their own row.
insert into public.push_devices (user_id, expo_push_token, platform) values
  ('30000000-0000-4000-8000-000000000001', 'ExponentPushToken[user-a-token]', 'ios');
select pg_temp.assert_true(
  exists (
    select 1 from public.push_devices
    where user_id = '30000000-0000-4000-8000-000000000001'
      and expo_push_token = 'ExponentPushToken[user-a-token]'
  ),
  'a user can insert their own device row'
);

-- 5. A user can update their own row.
update public.push_devices
set platform = 'ios-updated'
where user_id = '30000000-0000-4000-8000-000000000001'
  and expo_push_token = 'ExponentPushToken[user-a-token]';
select pg_temp.assert_true(
  (select platform = 'ios-updated' from public.push_devices
   where user_id = '30000000-0000-4000-8000-000000000001'
     and expo_push_token = 'ExponentPushToken[user-a-token]'),
  'a user can update their own device row'
);

-- 6. A user cannot insert a row on someone else's behalf: the with_check
-- clause rejects it before it ever lands.
do $forged_insert$
begin
  begin
    insert into public.push_devices (user_id, expo_push_token, platform) values
      ('30000000-0000-4000-8000-000000000002', 'ExponentPushToken[forged]', 'ios');
    raise exception 'a user was able to insert a device row for another user';
  exception
    when insufficient_privilege then
      null;
  end;
end
$forged_insert$;

reset role;

-- Seed user 2's row directly (bypassing RLS as the connecting superuser) so
-- there is something for user 1 to fail to see/touch below.
insert into public.push_devices (user_id, expo_push_token, platform) values
  ('30000000-0000-4000-8000-000000000002', 'ExponentPushToken[user-b-token]', 'android');

set role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', false);

-- 7. A user cannot read another user's rows.
select pg_temp.assert_true(
  not exists (
    select 1 from public.push_devices
    where user_id = '30000000-0000-4000-8000-000000000002'
  ),
  'a user cannot select another user''s device rows'
);

-- 8. A user cannot update another user's row (RLS USING silently filters it
-- out; zero rows affected, no exception).
update public.push_devices
set platform = 'hijacked'
where user_id = '30000000-0000-4000-8000-000000000002';
-- The verification must bypass RLS. Assertion 7 just proved user 1 cannot see
-- user 2's rows, so reading them as user 1 yields NULL no matter whether the
-- update was blocked, and assert_true treats NULL as a failure.
reset role;
select pg_temp.assert_true(
  (select platform = 'android' from public.push_devices
   where user_id = '30000000-0000-4000-8000-000000000002'
     and expo_push_token = 'ExponentPushToken[user-b-token]'),
  'a user cannot update another user''s device row'
);
set role authenticated;

-- 9. A user cannot delete another user's row.
delete from public.push_devices
where user_id = '30000000-0000-4000-8000-000000000002';
-- Same reason as assertion 8: the survivor check only means something when it
-- runs with RLS bypassed.
reset role;
select pg_temp.assert_true(
  exists (
    select 1 from public.push_devices
    where user_id = '30000000-0000-4000-8000-000000000002'
      and expo_push_token = 'ExponentPushToken[user-b-token]'
  ),
  'a user cannot delete another user''s device row'
);
set role authenticated;

-- 10. A user can delete their own row.
delete from public.push_devices
where user_id = '30000000-0000-4000-8000-000000000001'
  and expo_push_token = 'ExponentPushToken[user-a-token]';
select pg_temp.assert_true(
  not exists (
    select 1 from public.push_devices
    where user_id = '30000000-0000-4000-8000-000000000001'
      and expo_push_token = 'ExponentPushToken[user-a-token]'
  ),
  'a user can delete their own device row'
);

reset role;

-- 11. service_role can read across every user (bypassrls plus explicit
-- grants; the drain worker will rely on this later).
select pg_temp.assert_true(
  has_table_privilege('service_role', 'public.push_devices', 'select')
    and has_table_privilege('service_role', 'public.push_devices', 'insert')
    and has_table_privilege('service_role', 'public.push_devices', 'update')
    and has_table_privilege('service_role', 'public.push_devices', 'delete'),
  'service_role has full privileges on push_devices'
);

set role service_role;
select pg_temp.assert_true(
  (select count(*) = 1 from public.push_devices
   where user_id = '30000000-0000-4000-8000-000000000002'),
  'service_role can read another user''s token'
);
reset role;

select '0021 push devices: PASS' as result;

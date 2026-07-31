\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_avisos_0015_test' then
    raise exception 'Refusing to run outside taudux_avisos_0015_test';
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

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  rol text not null default 'usuario'
);

create function public.es_admin()
returns boolean language sql stable as $$ select true $$;

-- Cursos "preexistentes": ya publicados antes de aplicar la migración.
-- Deben quedar tombstoned por el backfill de supresión.
insert into public.cursos (id, titulo, estado) values
  ('10000000-0000-4000-8000-000000000001', 'Curso preexistente', 'publicado');

\ir ../migrations/0015_avisos_curso_nuevo.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

-- 6. Backfill de supresión: el curso preexistente publicado queda 'sent'.
select pg_temp.assert_true(
  (select status = 'sent' and completed_at is not null
   from public.curso_anuncios
   where curso_id = '10000000-0000-4000-8000-000000000001'),
  'backfill suppresses courses already published before migration'
);

-- 1. Insertar curso en borrador -> no encola.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000001', 'Curso en borrador', 'borrador');
select pg_temp.assert_true(
  not exists (
    select 1 from public.curso_anuncios
    where curso_id = '20000000-0000-4000-8000-000000000001'
  ),
  'inserting a draft course does not enqueue an announcement'
);

-- 2. borrador -> publicado: exactamente 1 fila 'pending'.
update public.cursos
set estado = 'publicado'
where id = '20000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(
  (select count(*) from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000001') = 1,
  'draft -> published enqueues exactly one row'
);
select pg_temp.assert_true(
  (select status = 'pending' from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000001'),
  'draft -> published enqueues in pending status'
);

-- 3. La prueba central: publicado -> archivado -> publicado sobre el mismo
-- curso no reencola ni duplica la fila.
update public.cursos
set estado = 'archivado'
where id = '20000000-0000-4000-8000-000000000001';
update public.cursos
set estado = 'publicado'
where id = '20000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(
  (select count(*) from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000001') = 1,
  'published -> archived -> published stays at exactly one row'
);
select pg_temp.assert_true(
  (select status = 'pending' from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000001'),
  'published -> archived -> published does not reset status'
);

-- 4. Insert directo de un curso nuevo ya publicado (sin pasar por borrador).
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000002', 'Curso publicado directo', 'publicado');
select pg_temp.assert_true(
  (select count(*) from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000002') = 1
  and (select status from public.curso_anuncios
       where curso_id = '20000000-0000-4000-8000-000000000002') = 'pending',
  'inserting directly as published enqueues one pending row'
);

-- 5. Update de otra columna en un curso ya publicado no crea ni duplica fila.
update public.cursos
set titulo = 'Curso publicado directo (editado)'
where id = '20000000-0000-4000-8000-000000000002';
select pg_temp.assert_true(
  (select count(*) from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000002') = 1,
  'updating a non-estado column on a published course does not duplicate the row'
);

-- 7. Grants por columna en perfiles: authenticated puede UPDATE
-- avisos_curso_nuevo pero no rol.
select pg_temp.assert_true(
  exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'perfiles'
      and column_name = 'avisos_curso_nuevo'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
  ),
  'authenticated has column UPDATE on perfiles.avisos_curso_nuevo'
);
select pg_temp.assert_true(
  not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'perfiles'
      and column_name = 'rol'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
  ),
  'authenticated has no column UPDATE on perfiles.rol'
);

-- 8. curso_anuncios fails closed: authenticated has nothing, service_role
-- has select.
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.curso_anuncios', 'select')
    and not has_table_privilege('authenticated', 'public.curso_anuncios', 'select'),
  'authenticated/anon have no privileges on curso_anuncios'
);
select pg_temp.assert_true(
  has_table_privilege('service_role', 'public.curso_anuncios', 'select'),
  'service_role can select curso_anuncios'
);

-- Claim/advance/complete lifecycle sanity check on the row from case 2/3.
update public.curso_anuncios
set next_attempt_at = pg_catalog.clock_timestamp() - interval '1 second'
where curso_id = '20000000-0000-4000-8000-000000000001';

insert into auth.users (id, email, email_confirmed_at, deleted_at) values
  ('30000000-0000-4000-8000-000000000001', 'suscrito@example.com', now(), null),
  ('30000000-0000-4000-8000-000000000002', 'sin-confirmar@example.com', null, null),
  ('30000000-0000-4000-8000-000000000003', 'opt-out@example.com', now(), null);
insert into public.perfiles (id, rol) values
  ('30000000-0000-4000-8000-000000000001', 'usuario'),
  ('30000000-0000-4000-8000-000000000002', 'usuario'),
  ('30000000-0000-4000-8000-000000000003', 'usuario');
update public.perfiles
set avisos_curso_nuevo = false
where id = '30000000-0000-4000-8000-000000000003';

create temp table first_claim as
select * from public.claim_curso_anuncio();
select pg_temp.assert_true(
  (select count(*) = 1 and min(claim_generation) = 1 from first_claim),
  'claim returns one generation-owned announcement'
);
select pg_temp.assert_true(
  (select curso_id from first_claim) = '20000000-0000-4000-8000-000000000001',
  'claim returns the expected curso_id'
);
select pg_temp.assert_true(
  (select titulo from first_claim) = 'Curso en borrador',
  'claim joins the course title'
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.destinatarios_curso_anuncio(null, 100)
   where email = 'suscrito@example.com'),
  'destinatarios includes confirmed opted-in users'
);
select pg_temp.assert_true(
  not exists (
    select 1 from public.destinatarios_curso_anuncio(null, 100)
    where email in ('sin-confirmar@example.com', 'opt-out@example.com')
  ),
  'destinatarios excludes unconfirmed and opted-out users'
);

select pg_temp.assert_true(
  public.avanzar_curso_anuncio(
    (select curso_id from first_claim),
    (select claim_token from first_claim),
    (select claim_generation from first_claim),
    '30000000-0000-4000-8000-000000000001',
    1
  ),
  'advancing the current claim owner succeeds'
);
select pg_temp.assert_true(
  public.completar_curso_anuncio(
    (select curso_id from first_claim),
    (select claim_token from first_claim),
    (select claim_generation from first_claim)
  ),
  'completing the current claim owner succeeds'
);
select pg_temp.assert_true(
  (select status = 'sent' and completed_at is not null and destinatarios_enviados = 1
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000001'),
  'completed announcement is terminal and records recipients sent'
);

select '0015 avisos curso nuevo: PASS' as result;

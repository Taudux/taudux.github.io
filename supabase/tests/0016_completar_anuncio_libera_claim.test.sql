\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_avisos_0016_test' then
    raise exception 'Refusing to run outside taudux_avisos_0016_test';
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

\ir ../migrations/0015_avisos_curso_nuevo.sql
\ir ../migrations/0016_completar_anuncio_libera_claim.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

-- 1. Regresión directa del bug: completar_curso_anuncio debe dejar la fila
-- 'sent' con claimed_at/claim_token en null, sin violar el constraint de
-- coherencia de claim.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000001', 'Curso de regresión', 'publicado');

create temp table claim_uno as
select * from public.claim_curso_anuncio();

select pg_temp.assert_true(
  (select count(*) = 1 from claim_uno),
  'hay un anuncio reclamable para el curso recién publicado'
);

select pg_temp.assert_true(
  public.completar_curso_anuncio(
    (select curso_id from claim_uno),
    (select claim_token from claim_uno),
    (select claim_generation from claim_uno)
  ),
  'completar_curso_anuncio ya no falla por el constraint de claim'
);

select pg_temp.assert_true(
  (select status = 'sent'
     and completed_at is not null
     and claimed_at is null
     and claim_token is null
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000001'),
  'la fila queda sent con claimed_at/claim_token limpios'
);

-- 2. Autosanación: una fila que el bug dejó trabada en 'processing' (con
-- error_count = 0, o sea que el envío ya había salido bien) se libera a
-- 'sent' al reaplicar 0016 — nunca a 'retry', porque reencolarla mandaría el
-- correo dos veces a gente que ya lo recibió.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000002', 'Curso trabado por el bug', 'publicado');

update public.curso_anuncios
set status = 'processing',
    claimed_at = now(),
    claim_token = pg_catalog.gen_random_uuid(),
    claim_generation = 1,
    error_count = 0
where curso_id = '20000000-0000-4000-8000-000000000002';

\ir ../migrations/0016_completar_anuncio_libera_claim.sql

select pg_temp.assert_true(
  (select status = 'sent' and claimed_at is null and claim_token is null
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000002'),
  'una fila trabada con error_count 0 se autosana a sent, no a retry'
);

-- 3. Una fila trabada CON errores previos (error_count > 0) sí vuelve a
-- 'retry': ahí el fallo fue del envío, no del cierre, y corresponde
-- reintentarla de verdad.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000003', 'Curso trabado con errores previos', 'publicado');

update public.curso_anuncios
set status = 'processing',
    claimed_at = now(),
    claim_token = pg_catalog.gen_random_uuid(),
    claim_generation = 1,
    error_count = 2
where curso_id = '20000000-0000-4000-8000-000000000003';

\ir ../migrations/0016_completar_anuncio_libera_claim.sql

select pg_temp.assert_true(
  (select status = 'retry' and claimed_at is null and claim_token is null and completed_at is null
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000003'),
  'una fila trabada con errores previos vuelve a retry, no a sent'
);

select '0016 completar anuncio libera claim: PASS' as result;

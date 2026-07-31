\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_avisos_0018_test' then
    raise exception 'Refusing to run outside taudux_avisos_0018_test';
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

-- es_admin() sensible al rol de una sesión simulada, para poder ejercer el
-- guard de forbidden en curso_anunciado desde este mismo script.
create function public.es_admin()
returns boolean language sql stable as $$
  select coalesce(current_setting('taudux.test_is_admin', true), 'true')::boolean;
$$;

\ir ../migrations/0015_avisos_curso_nuevo.sql
\ir ../migrations/0016_completar_anuncio_libera_claim.sql
\ir ../migrations/0018_republicar_reanuncia.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

-- 1. Una fila 'sent' se resetea a 'pending' al republicar: destinatarios en
-- 0, claim_generation incrementado (nunca a 0), created_at renovado.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000001', 'Curso ya anunciado', 'publicado');

update public.curso_anuncios
set status = 'sent',
    completed_at = now(),
    destinatarios_enviados = 42,
    ultimo_destinatario = '30000000-0000-4000-8000-000000000009',
    claim_generation = 3,
    created_at = now() - interval '3 days',
    updated_at = now() - interval '3 days'
where curso_id = '20000000-0000-4000-8000-000000000001';

update public.cursos set estado = 'archivado' where id = '20000000-0000-4000-8000-000000000001';
update public.cursos set estado = 'publicado' where id = '20000000-0000-4000-8000-000000000001';

select pg_temp.assert_true(
  (select status = 'pending'
     and destinatarios_enviados = 0
     and ultimo_destinatario is null
     and claim_generation = 4
     and completed_at is null
     and claimed_at is null
     and claim_token is null
     and created_at > now() - interval '1 minute'
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000001'),
  'a sent row resets to pending on republish, with claim_generation incremented and created_at renewed'
);

-- 2. Una fila 'expired' se revive (el hueco silencioso que motivó todo esto).
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000002', 'Curso expirado', 'publicado');

update public.curso_anuncios
set status = 'expired',
    completed_at = now(),
    claim_generation = 1
where curso_id = '20000000-0000-4000-8000-000000000002';

update public.cursos set estado = 'archivado' where id = '20000000-0000-4000-8000-000000000002';
update public.cursos set estado = 'publicado' where id = '20000000-0000-4000-8000-000000000002';

select pg_temp.assert_true(
  (select status = 'pending' and completed_at is null and claim_generation = 2
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000002'),
  'an expired row is revived to pending on republish'
);

-- 3. Una fila 'processing' NO se toca: ya está saliendo, resetearla le
-- robaría el claim al worker activo.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000003', 'Curso en vuelo', 'publicado');

update public.curso_anuncios
set status = 'processing',
    claimed_at = now(),
    claim_token = pg_catalog.gen_random_uuid(),
    claim_generation = 1,
    destinatarios_enviados = 10
where curso_id = '20000000-0000-4000-8000-000000000003';

update public.cursos set estado = 'archivado' where id = '20000000-0000-4000-8000-000000000003';
update public.cursos set estado = 'publicado' where id = '20000000-0000-4000-8000-000000000003';

select pg_temp.assert_true(
  (select status = 'processing' and claim_generation = 1 and destinatarios_enviados = 10
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000003'),
  'a processing row is left untouched on republish'
);

-- 3b. Lo mismo para 'pending' y 'retry': ya van camino a enviarse.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000004', 'Curso pendiente', 'publicado');
update public.curso_anuncios set claim_generation = 5 where curso_id = '20000000-0000-4000-8000-000000000004';
update public.cursos set estado = 'archivado' where id = '20000000-0000-4000-8000-000000000004';
update public.cursos set estado = 'publicado' where id = '20000000-0000-4000-8000-000000000004';
select pg_temp.assert_true(
  (select status = 'pending' and claim_generation = 5
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000004'),
  'a pending row is left untouched on republish'
);

insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000005', 'Curso en reintento', 'publicado');
update public.curso_anuncios
set status = 'retry', claim_generation = 2, error_count = 1
where curso_id = '20000000-0000-4000-8000-000000000005';
update public.cursos set estado = 'archivado' where id = '20000000-0000-4000-8000-000000000005';
update public.cursos set estado = 'publicado' where id = '20000000-0000-4000-8000-000000000005';
select pg_temp.assert_true(
  (select status = 'retry' and claim_generation = 2 and error_count = 1
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000005'),
  'a retry row is left untouched on republish'
);

-- 4. curso_anunciado: true solo cuando status = sent, false para pending, y
-- levanta forbidden para un no-admin.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000006', 'Curso sent', 'publicado');
update public.curso_anuncios set status = 'sent', completed_at = now()
where curso_id = '20000000-0000-4000-8000-000000000006';

select pg_temp.assert_true(
  public.curso_anunciado('20000000-0000-4000-8000-000000000006') = true,
  'curso_anunciado returns true for a sent announcement'
);
select pg_temp.assert_true(
  public.curso_anunciado('20000000-0000-4000-8000-000000000001') = false,
  'curso_anunciado returns false for a pending announcement (case 1, reset above)'
);
select pg_temp.assert_true(
  public.curso_anunciado('00000000-0000-4000-8000-000000000000') = false,
  'curso_anunciado returns false for a course with no announcement at all'
);

set local taudux.test_is_admin = 'false';
do $forbidden$
begin
  begin
    perform public.curso_anunciado('20000000-0000-4000-8000-000000000006');
    raise exception 'expected curso_anunciado to raise forbidden for a non-admin';
  exception
    when sqlstate '42501' then
      null;
  end;
end
$forbidden$;
set local taudux.test_is_admin = 'true';

select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.curso_anunciado(uuid)', 'execute'),
  'authenticated can execute curso_anunciado'
);
select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.curso_anunciado(uuid)', 'execute'),
  'anon cannot execute curso_anunciado'
);

select '0018 republicar reanuncia: PASS' as result;

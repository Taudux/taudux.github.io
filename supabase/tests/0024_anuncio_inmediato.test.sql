\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_anuncio_inmediato_0024_test' then
    raise exception 'Refusing to run outside taudux_anuncio_inmediato_0024_test';
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
\ir ../migrations/0024_anuncio_inmediato.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

-- 1. Publicar un curso NUEVO deja ambas filas reclamables de inmediato. Antes
--    de 0024 el default de la columna las empujaba 10 minutos al futuro.
insert into public.cursos (id, titulo, estado) values
  ('50000000-0000-4000-8000-000000000001', 'Curso publicado de una', 'publicado');

select pg_temp.assert_true(
  (select count(*) = 2 from public.curso_anuncios
   where curso_id = '50000000-0000-4000-8000-000000000001'),
  'publishing still enqueues one row per channel'
);

select pg_temp.assert_true(
  (select bool_and(next_attempt_at <= now()) from public.curso_anuncios
   where curso_id = '50000000-0000-4000-8000-000000000001'),
  'a freshly published course is claimable immediately, with no grace window'
);

-- 2. El default de la columna es el que cubre este camino; verificarlo directo
--    evita que una migración futura lo reintroduzca sin que nadie lo note.
select pg_temp.assert_true(
  (select pg_get_expr(d.adbin, d.adrelid) not like '%10 minutes%'
     from pg_attrdef d
     join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'public.curso_anuncios'::regclass
      and a.attname = 'next_attempt_at'),
  'the next_attempt_at column default no longer carries a ten-minute delay'
);

-- 3. REPUBLICAR un curso archivado también avisa de inmediato. Este camino no
--    pasa por el default de la columna sino por el `on conflict do update` del
--    trigger, que tenía su propio + interval '10 minutes' hardcodeado.
insert into public.cursos (id, titulo, estado) values
  ('50000000-0000-4000-8000-000000000002', 'Curso que se republica', 'publicado');

update public.curso_anuncios
set status = 'sent', completed_at = now(), claimed_at = null, claim_token = null
where curso_id = '50000000-0000-4000-8000-000000000002';

update public.cursos set estado = 'archivado'
where id = '50000000-0000-4000-8000-000000000002';
update public.cursos set estado = 'publicado'
where id = '50000000-0000-4000-8000-000000000002';

select pg_temp.assert_true(
  (select bool_and(status = 'pending') from public.curso_anuncios
   where curso_id = '50000000-0000-4000-8000-000000000002'),
  'republishing revives both channels'
);

select pg_temp.assert_true(
  (select bool_and(next_attempt_at <= now()) from public.curso_anuncios
   where curso_id = '50000000-0000-4000-8000-000000000002'),
  'a republished course is claimable immediately too'
);

-- 4. LO QUE NO SE TOCA: el backoff de reintentos sigue empujando el próximo
--    intento al futuro. Es una espera distinta de la ventana de gracia, y
--    confundirlas convertiría cada fallo en un bucle cerrado contra Resend o
--    Expo -- exactamente el reenvío en loop que este trabajo vino a cerrar.
insert into public.cursos (id, titulo, estado) values
  ('50000000-0000-4000-8000-000000000003', 'Curso que falla al enviar', 'publicado');

-- claim_curso_anuncio() devuelve UNA fila, la más vieja reclamable de toda la
-- cola. Cerrar las de los cursos anteriores deja al 3 como único candidato,
-- para que este bloque no dependa del orden de la cola.
update public.curso_anuncios
set status = 'sent', completed_at = now(), claimed_at = null, claim_token = null
where curso_id in (
  '50000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002'
);

do $backoff$
declare
  reclamado record;
  ok boolean;
begin
  select * into reclamado from public.claim_curso_anuncio() limit 1;

  if reclamado is null then
    raise exception 'expected to claim a row for the failing course';
  end if;

  ok := public.reintentar_curso_anuncio(
    reclamado.curso_id,
    reclamado.claim_token,
    reclamado.claim_generation,
    'expo_push_failed_500',
    reclamado.canal
  );

  if not ok then
    raise exception 'reintentar_curso_anuncio should have updated the claimed row';
  end if;
end
$backoff$;

select pg_temp.assert_true(
  (select next_attempt_at > now() from public.curso_anuncios
   where curso_id = '50000000-0000-4000-8000-000000000003'
     and status = 'retry'
   limit 1),
  'the retry backoff still pushes next_attempt_at into the future'
);

select '0024 anuncio inmediato: PASS' as result;

\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_anuncio_solo_push_0026_test' then
    raise exception 'Refusing to run outside taudux_anuncio_solo_push_0026_test';
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

-- Fixtures insertados con el trigger PRE-0026 todavía activo: cada INSERT de
-- abajo encola dos filas (email + push), tal cual hacía enqueue_curso_anuncio
-- desde 0022/0024. Son justamente las filas que 0026 tiene que encontrar y
-- cerrar (o dejar intactas) según su status y canal.

-- Cursos 01-03: quedan con la fila email en cada uno de los tres estados
-- "vivos" que la supresión debe cerrar.
insert into public.cursos (id, titulo, estado) values
  ('60000000-0000-4000-8000-000000000001', 'Curso email pending', 'publicado'),
  ('60000000-0000-4000-8000-000000000002', 'Curso email processing', 'publicado'),
  ('60000000-0000-4000-8000-000000000003', 'Curso email retry', 'publicado');

-- 01: la fila email ya nace 'pending' (default de 0024), se deja explícita
-- igual para que la fixture no dependa de un default silencioso.
update public.curso_anuncios
set status = 'pending', claimed_at = null, claim_token = null
where curso_id = '60000000-0000-4000-8000-000000000001' and canal = 'email';

-- 01 además deja su fila PUSH en un estado terminal ('sent'), a propósito:
-- esta misma fixture se reutiliza más abajo (sección 7) para probar que
-- republicar revive el push sin resucitar el email que 0026 va a cerrar.
update public.curso_anuncios
set status = 'sent',
    completed_at = now(),
    claimed_at = null,
    claim_token = null
where curso_id = '60000000-0000-4000-8000-000000000001' and canal = 'push';

-- 02: fila email en 'processing' con claim real, para ejercer de verdad
-- curso_anuncios_claim_consistent en la UPDATE de supresión.
update public.curso_anuncios
set status = 'processing',
    claimed_at = now(),
    claim_token = pg_catalog.gen_random_uuid(),
    claim_generation = 1
where curso_id = '60000000-0000-4000-8000-000000000002' and canal = 'email';

-- 03: fila email en 'retry', esperando su próximo intento.
update public.curso_anuncios
set status = 'retry',
    next_attempt_at = now() + interval '5 minutes',
    claimed_at = null,
    claim_token = null
where curso_id = '60000000-0000-4000-8000-000000000003' and canal = 'email';

-- Cursos 04-05: filas email ya TERMINALES antes de 0026. Deben quedar
-- exactamente como estaban -- son registro histórico de lo que ya salió (o
-- no) por ese canal.
insert into public.cursos (id, titulo, estado) values
  ('60000000-0000-4000-8000-000000000004', 'Curso email sent', 'publicado'),
  ('60000000-0000-4000-8000-000000000005', 'Curso email failed', 'publicado');

update public.curso_anuncios
set status = 'sent',
    completed_at = now() - interval '2 days',
    claimed_at = null,
    claim_token = null,
    last_error = null
where curso_id = '60000000-0000-4000-8000-000000000004' and canal = 'email';

update public.curso_anuncios
set status = 'failed',
    completed_at = now() - interval '1 day',
    claimed_at = null,
    claim_token = null,
    last_error = 'resend_batch_failed_500'
where curso_id = '60000000-0000-4000-8000-000000000005' and canal = 'email';

-- Snapshot de los valores "antes de 0026" que las secciones 2 y 3 van a
-- comparar contra lo que quede después de aplicar la migración.
create temp table antes_de_0026 as
select curso_id, canal, status, completed_at, last_error, claim_generation
from public.curso_anuncios
where curso_id in (
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000002',
  '60000000-0000-4000-8000-000000000003',
  '60000000-0000-4000-8000-000000000004',
  '60000000-0000-4000-8000-000000000005'
);

\ir ../migrations/0026_anuncio_solo_push.sql

-- 1. SUPRESIÓN EN VUELO en los tres status vivos: pending, processing (con
--    claim real) y retry quedan las tres 'expired', con completed_at
--    seteado, claimed_at/claim_token en null y last_error marcando el
--    motivo. Esto es lo que evita que el próximo barrido de pg_cron reclame
--    una de estas filas y mande un correo real.
select pg_temp.assert_true(
  (select status = 'expired'
     and completed_at is not null
     and claimed_at is null
     and claim_token is null
     and last_error = 'email_channel_retired'
   from public.curso_anuncios
   where curso_id = '60000000-0000-4000-8000-000000000001' and canal = 'email'),
  'a pending email row is closed as expired by the suppression update'
);
select pg_temp.assert_true(
  (select status = 'expired'
     and completed_at is not null
     and claimed_at is null
     and claim_token is null
     and last_error = 'email_channel_retired'
   from public.curso_anuncios
   where curso_id = '60000000-0000-4000-8000-000000000002' and canal = 'email'),
  'a processing email row (real claim fields) is closed as expired without violating curso_anuncios_claim_consistent'
);
select pg_temp.assert_true(
  (select status = 'expired'
     and completed_at is not null
     and claimed_at is null
     and claim_token is null
     and last_error = 'email_channel_retired'
   from public.curso_anuncios
   where curso_id = '60000000-0000-4000-8000-000000000003' and canal = 'email'),
  'a retry email row is closed as expired by the suppression update'
);

-- 2. FILAS EMAIL TERMINALES NO SE TOCAN: sent y failed quedan con el mismo
--    status, completed_at y last_error que tenían antes de 0026.
select pg_temp.assert_true(
  (select a.status = b.status
     and a.completed_at = b.completed_at
     and a.last_error is not distinct from b.last_error
   from antes_de_0026 a
   join public.curso_anuncios b
     on b.curso_id = a.curso_id and b.canal = a.canal
   where a.curso_id = '60000000-0000-4000-8000-000000000004' and a.canal = 'email'),
  'a sent email row is left completely untouched by 0026'
);
select pg_temp.assert_true(
  (select a.status = b.status
     and a.completed_at = b.completed_at
     and a.last_error is not distinct from b.last_error
   from antes_de_0026 a
   join public.curso_anuncios b
     on b.curso_id = a.curso_id and b.canal = a.canal
   where a.curso_id = '60000000-0000-4000-8000-000000000005' and a.canal = 'email'),
  'a failed email row is left completely untouched by 0026'
);

-- 3. FILAS PUSH DE ESOS MISMOS CURSOS NO SE TOCAN: prueba que la supresión
--    está acotada estrictamente a canal = 'email'. El curso 01 tenía su
--    push en 'sent' a propósito (fixture para la sección 7 de más abajo) y
--    debe seguir en 'sent'; los demás siguen en el 'pending' con el que
--    nacieron.
select pg_temp.assert_true(
  (select a.status = b.status and a.claim_generation = b.claim_generation
   from antes_de_0026 a
   join public.curso_anuncios b
     on b.curso_id = a.curso_id and b.canal = a.canal
   where a.curso_id = '60000000-0000-4000-8000-000000000001' and a.canal = 'push'),
  'the push row of course 01 (deliberately sent) is untouched by the email-only suppression'
);
select pg_temp.assert_true(
  (select bool_and(a.status = b.status and a.claim_generation = b.claim_generation)
   from antes_de_0026 a
   join public.curso_anuncios b
     on b.curso_id = a.curso_id and b.canal = a.canal
   where a.curso_id in (
     '60000000-0000-4000-8000-000000000002',
     '60000000-0000-4000-8000-000000000003',
     '60000000-0000-4000-8000-000000000004',
     '60000000-0000-4000-8000-000000000005'
   ) and a.canal = 'push'),
  'the still-pending push rows of courses 02-05 are untouched by the email-only suppression'
);

-- 4. PUBLICAR UN CURSO NUEVO DESPUÉS DE 0026 encola exactamente UNA fila,
--    canal push, pending desde cero. Se publica vía UPDATE (borrador ->
--    publicado) para ejercer la misma rama del trigger que usa
--    republicación en producción.
insert into public.cursos (id, titulo, estado) values
  ('60000000-0000-4000-8000-000000000006', 'Curso nuevo post 0026', 'borrador');
update public.cursos set estado = 'publicado'
where id = '60000000-0000-4000-8000-000000000006';

select pg_temp.assert_true(
  (select count(*) = 1 from public.curso_anuncios
   where curso_id = '60000000-0000-4000-8000-000000000006'),
  'publishing a course after 0026 enqueues exactly one row'
);
select pg_temp.assert_true(
  (select canal = 'push'
     and status = 'pending'
     and claim_generation = 0
     and attempt_count = 0
   from public.curso_anuncios
   where curso_id = '60000000-0000-4000-8000-000000000006'),
  'the single enqueued row is canal = push, pending, claim_generation 0, attempt_count 0'
);

-- 5. NINGUNA FILA EMAIL SE CREA para ese curso. Esta es la afirmación
--    central de todo el cambio.
select pg_temp.assert_true(
  not exists (
    select 1 from public.curso_anuncios
    where curso_id = '60000000-0000-4000-8000-000000000006' and canal = 'email'
  ),
  'no email row is ever created for a course published after 0026'
);

-- 6. LA CORRECCIÓN DE 0024 SE CONSERVA: el push recién encolado es
--    reclamable de inmediato, sin la ventana de gracia de 10 minutos.
select pg_temp.assert_true(
  (select next_attempt_at <= now() from public.curso_anuncios
   where curso_id = '60000000-0000-4000-8000-000000000006' and canal = 'push'),
  'the freshly enqueued push row is claimable immediately, matching the 0024 fix'
);

-- 7. REPUBLICAR REVIVE SOLO EL PUSH. El curso 01 tiene push 'sent'
--    (terminal) y email 'expired' (cerrado por la supresión en la
--    sección 1). Archivar y republicar debe revivir únicamente la fila
--    push -- el INSERT del trigger post-0026 ya no incluye una fila email
--    en su VALUES, así que la fila email ni siquiera entra en juego en el
--    on conflict.
update public.cursos set estado = 'archivado'
where id = '60000000-0000-4000-8000-000000000001';
update public.cursos set estado = 'publicado'
where id = '60000000-0000-4000-8000-000000000001';

select pg_temp.assert_true(
  (select status = 'pending'
     and claim_generation = 1
     and completed_at is null
     and claimed_at is null
     and claim_token is null
   from public.curso_anuncios
   where curso_id = '60000000-0000-4000-8000-000000000001' and canal = 'push'),
  'republishing revives the terminal push row to pending, claim_generation incremented by exactly 1'
);
select pg_temp.assert_true(
  (select status = 'expired' and claim_generation = 0
   from public.curso_anuncios
   where curso_id = '60000000-0000-4000-8000-000000000001' and canal = 'email'),
  'republishing does not touch the already-expired email row of the same course; its claim_generation never moves'
);

-- 8. GUARD DE PUSH EN VUELO SOBREVIVE UNA REPUBLICACIÓN: una fila push en
--    'processing' con claim real no debe moverse ni un bit cuando su curso
--    se republica -- el `where ... in ('sent', 'failed', 'expired')` del on
--    conflict la excluye.
insert into public.cursos (id, titulo, estado) values
  ('60000000-0000-4000-8000-000000000007', 'Curso push en vuelo', 'borrador');
update public.cursos set estado = 'publicado'
where id = '60000000-0000-4000-8000-000000000007';

do $push_en_vuelo$
declare
  token_original uuid := pg_catalog.gen_random_uuid();
begin
  update public.curso_anuncios
  set status = 'processing',
      claimed_at = pg_catalog.clock_timestamp(),
      claim_token = token_original,
      claim_generation = claim_generation + 1
  where curso_id = '60000000-0000-4000-8000-000000000007' and canal = 'push';

  update public.cursos set estado = 'archivado'
  where id = '60000000-0000-4000-8000-000000000007';
  update public.cursos set estado = 'publicado'
  where id = '60000000-0000-4000-8000-000000000007';

  perform pg_temp.assert_true(
    (select status = 'processing' and claim_token = token_original
     from public.curso_anuncios
     where curso_id = '60000000-0000-4000-8000-000000000007' and canal = 'push'),
    'a push row that is in-flight (processing) survives a republish of its course untouched'
  );
end
$push_en_vuelo$;

-- 9. curso_anunciado() REPORTA PUSH, no email. Curso 06 (solo push, todavía
--    pending) debe dar false; una vez que su push pasa a 'sent', debe dar
--    true.
select pg_temp.assert_true(
  public.curso_anunciado('60000000-0000-4000-8000-000000000006') = false,
  'curso_anunciado is false while the push row is still pending'
);

update public.curso_anuncios
set status = 'sent', completed_at = now(), claimed_at = null, claim_token = null
where curso_id = '60000000-0000-4000-8000-000000000006' and canal = 'push';

select pg_temp.assert_true(
  public.curso_anunciado('60000000-0000-4000-8000-000000000006') = true,
  'curso_anunciado turns true once the push row is sent'
);

-- Regresión clave: el curso 04 tiene su fila EMAIL en 'sent' (desde antes de
-- 0026, nunca tocada) y su fila PUSH sigue 'pending' (nunca reclamada).
-- Contra la definición pre-0026 esto daría true (miraba email); contra la
-- definición nueva debe dar false, porque lo único que importa ahora es el
-- push. Esta es la aserción que se rompe si el repunte de curso_anunciado
-- se omite.
select pg_temp.assert_true(
  public.curso_anunciado('60000000-0000-4000-8000-000000000004') = false,
  'curso_anunciado is false when the email row is sent but the push row of the same course is still pending'
);

-- 10. EL GUARD DE es_admin() SE MANTIENE. Plain SET, no SET LOCAL: psql
--     corre en autocommit, así que no hay transacción envolvente a la que
--     SET LOCAL pueda acotarse -- avisaría, dejaría el GUC en string vacío,
--     y el coalesce(..., 'true') de es_admin() no lo capturaría (coalesce
--     solo reemplaza NULL), así que ''::boolean abortaría la corrida. El
--     valor se restaura explícitamente después del check.
set taudux.test_is_admin = 'false';
do $forbidden$
begin
  begin
    perform public.curso_anunciado('60000000-0000-4000-8000-000000000006');
    raise exception 'expected curso_anunciado to raise forbidden for a non-admin';
  exception
    when sqlstate '42501' then
      null;
  end;
end
$forbidden$;
set taudux.test_is_admin = 'true';

-- 11. claim_curso_anuncio() SIGUE FUNCIONANDO PARA PUSH y jamás devuelve una
--     fila que la supresión dejó 'expired'. Se drena en loop todo lo
--     pendiente/reclamable de la cola.
create temp table reclamados_0026 (curso_id uuid, canal text);
do $drenar$
declare
  claimed_curso uuid;
  claimed_canal text;
begin
  -- Loop acotado (no `loop` infinito): drena hasta 50 filas, más que
  -- suficiente para lo que este script encoló, y evita colgarse si algo
  -- saliera mal.
  for i in 1..50 loop
    select curso_id, canal into claimed_curso, claimed_canal
    from public.claim_curso_anuncio();

    exit when claimed_curso is null;

    insert into reclamados_0026 (curso_id, canal) values (claimed_curso, claimed_canal);
  end loop;
end
$drenar$;

select pg_temp.assert_true(
  (select coalesce(bool_and(canal = 'push'), true) from reclamados_0026),
  'every row claim_curso_anuncio returns while draining the queue is canal = push'
);
select pg_temp.assert_true(
  not exists (
    select 1
    from reclamados_0026 r
    join public.curso_anuncios ca
      on ca.curso_id = r.curso_id and ca.canal = r.canal
    where ca.last_error = 'email_channel_retired'
  ),
  'claim_curso_anuncio never surfaces a row that the 0026 suppression closed as expired'
);

-- 12. IDEMPOTENCIA: reaplicar 0026 una segunda vez no debe alterar una fila
--     push ya terminal ni las filas email que la primera corrida ya cerró.
create temp table antes_de_repetir as
select curso_id, canal, status, completed_at, last_error
from public.curso_anuncios
where (curso_id = '60000000-0000-4000-8000-000000000006' and canal = 'push')
   or (canal = 'email' and curso_id in (
        '60000000-0000-4000-8000-000000000001',
        '60000000-0000-4000-8000-000000000002',
        '60000000-0000-4000-8000-000000000003'
      ));

\ir ../migrations/0026_anuncio_solo_push.sql

select pg_temp.assert_true(
  (select bool_and(a.status = b.status
     and a.completed_at = b.completed_at
     and a.last_error is not distinct from b.last_error)
   from antes_de_repetir a
   join public.curso_anuncios b
     on b.curso_id = a.curso_id and b.canal = a.canal),
  're-running 0026 a second time leaves the already-sent push row and the already-closed email rows unchanged'
);

select '0026 anuncio solo push: PASS' as result;

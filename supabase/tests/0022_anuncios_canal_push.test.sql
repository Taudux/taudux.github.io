\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_anuncios_canal_0022_test' then
    raise exception 'Refusing to run outside taudux_anuncios_canal_0022_test';
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

-- Fixture insertado ANTES de 0015: representa un curso que ya estaba
-- 'publicado' antes de que existiera cualquiera de estas migraciones. Ni
-- 0015 ni 0022 ven pasar el trigger cursos_enqueue_anuncio por este INSERT
-- (todavía no existe), así que el único origen posible de sus filas en
-- curso_anuncios son los backfills de supresión de cada migración.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000001', 'Curso ya publicado antes de 0022', 'publicado');

\ir ../migrations/0015_avisos_curso_nuevo.sql
\ir ../migrations/0016_completar_anuncio_libera_claim.sql
\ir ../migrations/0018_republicar_reanuncia.sql
\ir ../migrations/0022_anuncios_canal_push.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

-- 1. El curso ya publicado antes de 0022 queda suprimido en AMBOS canales:
--    canal = 'email' por el backfill original de 0015 (sin tocar), y
--    canal = 'push' por el backfill nuevo de 0022. Ninguno queda 'pending'.
select pg_temp.assert_true(
  (select status = 'sent' and completed_at is not null
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000001' and canal = 'email'),
  'the pre-existing email backfill row from 0015 stays sent, untouched by 0022'
);
select pg_temp.assert_true(
  (select status = 'sent' and completed_at is not null
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000001' and canal = 'push'),
  '0022 suppression backfill marks the push row of an already-published course as sent'
);
select pg_temp.assert_true(
  (select count(*) = 2 from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000001'),
  'the suppressed course has exactly one row per canal, no extra rows'
);

-- 2. Publicar un curso nuevo (después de aplicar 0022) encola exactamente 2
--    filas: una por canal, ambas 'pending' desde cero.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000002', 'Curso nuevo dos canales', 'publicado');

select pg_temp.assert_true(
  (select count(*) = 2 from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000002'),
  'publishing a course enqueues exactly 2 rows, one per canal'
);
select pg_temp.assert_true(
  (select array_agg(canal order by canal) = array['email', 'push']::text[]
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000002'),
  'the two enqueued rows are canal = email and canal = push'
);
select pg_temp.assert_true(
  (select bool_and(status = 'pending' and claim_generation = 0 and attempt_count = 0)
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000002'),
  'both freshly enqueued rows start pending with claim_generation 0'
);

-- 3. claim_curso_anuncio() NUNCA devuelve una fila canal = 'push', sin
--    importar cuán vencida esté: el fix del BLOCKER confirmado en la
--    revisión de 0022 acota la SELECT de candidatos a `canal = 'email'`
--    ANTES de mirar next_attempt_at o staleness, así que una fila push
--    jamás entra siquiera a competir por el `for update skip locked`. Al
--    mismo tiempo, la fila email del mismo curso se sigue reclamando
--    exactamente como antes de 0022: el canal push conviviendo en la tabla
--    no le cambia nada al camino de email.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000007', 'Curso push inerte, email normal', 'publicado');

-- La fila push queda MUY vencida (pasado incluso el umbral de expiración de
-- 7 días) a propósito: prueba que ni siquiera eso la hace candidata. El
-- filtro por canal la descarta antes de que la lógica de antigüedad llegue
-- a mirarla.
update public.curso_anuncios
set next_attempt_at = now() - interval '30 days',
    created_at = now() - interval '30 days'
where curso_id = '20000000-0000-4000-8000-000000000007' and canal = 'push';

update public.curso_anuncios
set next_attempt_at = now() - interval '1 minute'
where curso_id = '20000000-0000-4000-8000-000000000007' and canal = 'email';

do $claim_never_push$
declare
  claimed_curso uuid;
  claimed_canal text;
begin
  -- Llamar claim_curso_anuncio() repetidamente hasta drenar todo lo que
  -- esté vencido en la tabla (no solo la fila de este curso): ninguna
  -- llamada, en ningún momento, puede devolver canal = 'push'.
  for i in 1..50 loop
    select curso_id, canal into claimed_curso, claimed_canal
    from public.claim_curso_anuncio();

    exit when claimed_curso is null;

    perform pg_temp.assert_true(
      claimed_canal <> 'push',
      'claim_curso_anuncio never surfaces a canal = push row, no matter how overdue'
    );
  end loop;
end
$claim_never_push$;

select pg_temp.assert_true(
  (select status = 'processing' and claimed_at is not null and claim_token is not null
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000007' and canal = 'email'),
  'claim_curso_anuncio still claims the email row of a course normally, even while that same course''s push row sits pending/overdue'
);

-- La fila push es genuinamente inerte: sigue pending, sin claim_token, sin
-- claimed_at, sin haber avanzado de claim_generation, después de que
-- claim_curso_anuncio() se llamó tantas veces como hizo falta para drenar
-- todo lo demás que estaba vencido. Esto también cubre REL-002: las ramas
-- internas de expiración de claim_curso_anuncio() son estructuralmente
-- inalcanzables para esta fila, porque el filtro por canal la descarta
-- antes de que la SELECT de candidatos la seleccione — así que tampoco
-- puede terminar en 'expired' pese a estar vencida hace 30 días.
select pg_temp.assert_true(
  (select status = 'pending'
     and claimed_at is null
     and claim_token is null
     and claim_generation = 0
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000007' and canal = 'push'),
  'the push row stays pending, unclaimed, and untouched no matter how many times claim_curso_anuncio is called'
);

-- 4. avanzar_curso_anuncio solo afecta la fila (curso_id, canal) exacta: la
--    fila del otro canal del mismo curso, ya reclamada, no se mueve un bit.
--    La fila push se reclama A MANO (no vía claim_curso_anuncio(), que ya
--    nunca la devuelve desde el fix de la sección 3): se replica el mismo
--    UPDATE que hace claim_curso_anuncio() por dentro para obtener un
--    claim_token real. Esto sigue probando exactamente lo que hace falta —
--    que avanzar_curso_anuncio filtra por (curso_id, canal) sin importar
--    cómo llegó la fila a 'processing'.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000010', 'Curso avanzar', 'publicado');
update public.curso_anuncios
set next_attempt_at = now() - interval '1 minute'
where curso_id = '20000000-0000-4000-8000-000000000010' and canal = 'email';

do $test_avanzar$
declare
  email_token uuid;
  email_gen bigint;
  push_token uuid;
  push_gen bigint;
  ok boolean;
begin
  select claim_token, claim_generation into email_token, email_gen
  from public.claim_curso_anuncio();

  update public.curso_anuncios
  set status = 'processing',
      claim_token = pg_catalog.gen_random_uuid(),
      claim_generation = claim_generation + 1,
      claimed_at = pg_catalog.clock_timestamp()
  where curso_id = '20000000-0000-4000-8000-000000000010' and canal = 'push'
  returning claim_token, claim_generation into push_token, push_gen;

  select public.avanzar_curso_anuncio(
    '20000000-0000-4000-8000-000000000010'::uuid,
    email_token,
    email_gen,
    '30000000-0000-4000-8000-000000000099'::uuid,
    5,
    'email'
  ) into ok;

  perform pg_temp.assert_true(ok = true, 'avanzar_curso_anuncio succeeds for the matching (curso_id, canal)');
  perform pg_temp.assert_true(
    (select destinatarios_enviados = 5 and ultimo_destinatario = '30000000-0000-4000-8000-000000000099'
     from public.curso_anuncios
     where curso_id = '20000000-0000-4000-8000-000000000010' and canal = 'email'),
    'avanzar_curso_anuncio advances the email row cursor'
  );
  perform pg_temp.assert_true(
    (select destinatarios_enviados = 0
       and ultimo_destinatario is null
       and status = 'processing'
       and claim_token = push_token
       and claim_generation = push_gen
     from public.curso_anuncios
     where curso_id = '20000000-0000-4000-8000-000000000010' and canal = 'push'),
    'avanzar_curso_anuncio on the email row leaves the manually claimed push row of the same curso untouched'
  );
end
$test_avanzar$;

-- 5. completar_curso_anuncio: idem (push reclamado a mano, ver sección 4),
--    y además prueba que canal es parte real del filtro (no solo un
--    adorno) pasando el token correcto de push junto con canal = 'email',
--    que no debe matchear ninguna fila.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000011', 'Curso completar', 'publicado');
update public.curso_anuncios
set next_attempt_at = now() - interval '1 minute'
where curso_id = '20000000-0000-4000-8000-000000000011' and canal = 'email';

do $test_completar$
declare
  email_token uuid;
  email_gen bigint;
  push_token uuid;
  push_gen bigint;
  ok boolean;
begin
  select claim_token, claim_generation into email_token, email_gen
  from public.claim_curso_anuncio();

  update public.curso_anuncios
  set status = 'processing',
      claim_token = pg_catalog.gen_random_uuid(),
      claim_generation = claim_generation + 1,
      claimed_at = pg_catalog.clock_timestamp()
  where curso_id = '20000000-0000-4000-8000-000000000011' and canal = 'push'
  returning claim_token, claim_generation into push_token, push_gen;

  -- canal mal emparejado con un claim_token real (el de push): no debe
  -- completar nada, porque ninguna fila tiene canal = 'email' AND
  -- claim_token = push_token a la vez.
  select public.completar_curso_anuncio(
    '20000000-0000-4000-8000-000000000011'::uuid,
    push_token,
    push_gen,
    'email'
  ) into ok;
  perform pg_temp.assert_true(
    ok = false,
    'completar_curso_anuncio refuses a token that belongs to the other canal of the same curso'
  );
  perform pg_temp.assert_true(
    (select status = 'processing' from public.curso_anuncios
     where curso_id = '20000000-0000-4000-8000-000000000011' and canal = 'push'),
    'the push row survives a completar attempt made under the wrong canal'
  );

  select public.completar_curso_anuncio(
    '20000000-0000-4000-8000-000000000011'::uuid,
    email_token,
    email_gen,
    'email'
  ) into ok;
  perform pg_temp.assert_true(ok = true, 'completar_curso_anuncio succeeds for the matching (curso_id, canal)');
  perform pg_temp.assert_true(
    (select status = 'sent' and claimed_at is null and claim_token is null and completed_at is not null
     from public.curso_anuncios
     where curso_id = '20000000-0000-4000-8000-000000000011' and canal = 'email'),
    'completar_curso_anuncio closes the email row and releases its claim (0016 fix preserved)'
  );
  perform pg_temp.assert_true(
    (select status = 'processing' and claim_token = push_token and claim_generation = push_gen
     from public.curso_anuncios
     where curso_id = '20000000-0000-4000-8000-000000000011' and canal = 'push'),
    'completing the email job leaves the manually claimed push job of the same curso completely untouched'
  );
end
$test_completar$;

-- 5b. Regresión directa del BLOCKER confirmado en la revisión de 0022: el
--     edge function desplegado hoy llama a las 4 funciones de job con
--     argumentos NOMBRADOS y SIN p_canal (ver
--     supabase/functions/notify-course-published/index.ts, que nunca
--     manda p_canal en ningún rpc()). El default 'email' agregado a p_canal
--     tiene que hacer que esa llamada, tal cual la hace el edge function
--     hoy, se comporte exactamente igual que pasar p_canal := 'email'
--     explícito — si no, cada avance del pipeline de email fallaría apenas
--     se aplique esta migración, incluso antes de que exista una sola fila
--     push.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000015', 'Curso default canal omitido', 'publicado');
update public.curso_anuncios
set next_attempt_at = now() - interval '1 minute'
where curso_id = '20000000-0000-4000-8000-000000000015' and canal = 'email';

do $test_default_canal$
declare
  email_token uuid;
  email_gen bigint;
  ok boolean;
begin
  select claim_token, claim_generation into email_token, email_gen
  from public.claim_curso_anuncio();

  -- Exactamente la forma en la que llama el edge function actual: named
  -- args, sin p_canal.
  select public.completar_curso_anuncio(
    p_curso_id := '20000000-0000-4000-8000-000000000015'::uuid,
    p_claim_token := email_token,
    p_claim_generation := email_gen
  ) into ok;

  perform pg_temp.assert_true(
    ok = true,
    'completar_curso_anuncio called without p_canal, exactly like the current unmodified edge function, succeeds against a real email claim token because p_canal defaults to email'
  );
  perform pg_temp.assert_true(
    (select status = 'sent' and claimed_at is null and claim_token is null and completed_at is not null
     from public.curso_anuncios
     where curso_id = '20000000-0000-4000-8000-000000000015' and canal = 'email'),
    'omitting p_canal behaves identically to passing p_canal := ''email'' explicitly'
  );
end
$test_default_canal$;

-- 6. pausar_curso_anuncio: idem (push reclamado a mano, ver sección 4).
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000012', 'Curso pausar', 'publicado');
update public.curso_anuncios
set next_attempt_at = now() - interval '1 minute'
where curso_id = '20000000-0000-4000-8000-000000000012' and canal = 'email';

do $test_pausar$
declare
  email_token uuid;
  email_gen bigint;
  push_token uuid;
  push_gen bigint;
  ok boolean;
begin
  select claim_token, claim_generation into email_token, email_gen
  from public.claim_curso_anuncio();

  update public.curso_anuncios
  set status = 'processing',
      claim_token = pg_catalog.gen_random_uuid(),
      claim_generation = claim_generation + 1,
      claimed_at = pg_catalog.clock_timestamp()
  where curso_id = '20000000-0000-4000-8000-000000000012' and canal = 'push'
  returning claim_token, claim_generation into push_token, push_gen;

  select public.pausar_curso_anuncio(
    '20000000-0000-4000-8000-000000000012'::uuid,
    push_token,
    push_gen,
    'push'
  ) into ok;

  perform pg_temp.assert_true(ok = true, 'pausar_curso_anuncio succeeds for the matching (curso_id, canal)');
  perform pg_temp.assert_true(
    (select status = 'retry' and claimed_at is null and claim_token is null
     from public.curso_anuncios
     where curso_id = '20000000-0000-4000-8000-000000000012' and canal = 'push'),
    'pausar_curso_anuncio returns the manually claimed push row to retry without touching error_count'
  );
  perform pg_temp.assert_true(
    (select status = 'processing' and claim_token = email_token and claim_generation = email_gen
     from public.curso_anuncios
     where curso_id = '20000000-0000-4000-8000-000000000012' and canal = 'email'),
    'pausing the push job leaves the email job of the same curso completely untouched'
  );
end
$test_pausar$;

-- 7. reintentar_curso_anuncio: idem (push reclamado a mano, ver sección 4).
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000013', 'Curso reintentar', 'publicado');
update public.curso_anuncios
set next_attempt_at = now() - interval '1 minute'
where curso_id = '20000000-0000-4000-8000-000000000013' and canal = 'email';

do $test_reintentar$
declare
  email_token uuid;
  email_gen bigint;
  push_token uuid;
  push_gen bigint;
  ok boolean;
begin
  select claim_token, claim_generation into email_token, email_gen
  from public.claim_curso_anuncio();

  update public.curso_anuncios
  set status = 'processing',
      claim_token = pg_catalog.gen_random_uuid(),
      claim_generation = claim_generation + 1,
      claimed_at = pg_catalog.clock_timestamp()
  where curso_id = '20000000-0000-4000-8000-000000000013' and canal = 'push'
  returning claim_token, claim_generation into push_token, push_gen;

  select public.reintentar_curso_anuncio(
    '20000000-0000-4000-8000-000000000013'::uuid,
    email_token,
    email_gen,
    'resend_batch_failed_500',
    'email'
  ) into ok;

  perform pg_temp.assert_true(ok = true, 'reintentar_curso_anuncio succeeds for the matching (curso_id, canal)');
  perform pg_temp.assert_true(
    (select status = 'retry' and error_count = 1 and claimed_at is null and claim_token is null
     from public.curso_anuncios
     where curso_id = '20000000-0000-4000-8000-000000000013' and canal = 'email'),
    'reintentar_curso_anuncio schedules a retry for the email row'
  );
  perform pg_temp.assert_true(
    (select status = 'processing' and error_count = 0
       and claim_token = push_token and claim_generation = push_gen
     from public.curso_anuncios
     where curso_id = '20000000-0000-4000-8000-000000000013' and canal = 'push'),
    'retrying the email job leaves the manually claimed push job of the same curso completely untouched'
  );
end
$test_reintentar$;

-- 8. curso_anunciado sigue reflejando solo el canal email, tal cual antes de
--    0022: un push enviado no debe hacerlo devolver true.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000014', 'Curso solo push enviado', 'publicado');
update public.curso_anuncios
set status = 'sent', completed_at = now(), claimed_at = null, claim_token = null
where curso_id = '20000000-0000-4000-8000-000000000014' and canal = 'push';

select pg_temp.assert_true(
  public.curso_anunciado('20000000-0000-4000-8000-000000000014') = false,
  'curso_anunciado stays false when only the push channel is sent'
);

update public.curso_anuncios
set status = 'sent', completed_at = now(), claimed_at = null, claim_token = null
where curso_id = '20000000-0000-4000-8000-000000000014' and canal = 'email';

select pg_temp.assert_true(
  public.curso_anunciado('20000000-0000-4000-8000-000000000014') = true,
  'curso_anunciado turns true once the email channel is sent, regardless of push'
);

-- READ-001: curso_anunciado sigue exigiendo es_admin() tras 0022 (0022 no
-- toca ese guard, solo el filtro de canal).
--
-- Plain SET, not SET LOCAL: psql runs in autocommit, so there is no surrounding
-- transaction for SET LOCAL to scope to. It would warn, leave the GUC as an
-- empty string, and es_admin()'s coalesce(..., 'true') would not catch it --
-- coalesce only replaces NULL -- so ''::boolean would abort the run. The value
-- is restored explicitly after the check. (0018_republicar_reanuncia.test.sql
-- still carries the SET LOCAL version of this idiom and has the same latent
-- failure.)
set taudux.test_is_admin = 'false';
do $forbidden$
begin
  begin
    perform public.curso_anunciado('20000000-0000-4000-8000-000000000014');
    raise exception 'expected curso_anunciado to raise forbidden for a non-admin';
  exception
    when sqlstate '42501' then
      null;
  end;
end
$forbidden$;
set taudux.test_is_admin = 'true';

-- 9. Republicar revive AMBOS canales: una fila terminal en cada canal vuelve
--    a pending, con claim_generation incrementado (nunca a 0) en cada una.
insert into public.cursos (id, titulo, estado) values
  ('20000000-0000-4000-8000-000000000003', 'Curso republicado dos canales', 'publicado');

update public.curso_anuncios
set status = 'sent',
    completed_at = now(),
    claim_generation = 3,
    created_at = now() - interval '3 days',
    updated_at = now() - interval '3 days'
where curso_id = '20000000-0000-4000-8000-000000000003';

update public.cursos set estado = 'archivado' where id = '20000000-0000-4000-8000-000000000003';
update public.cursos set estado = 'publicado' where id = '20000000-0000-4000-8000-000000000003';

select pg_temp.assert_true(
  (select count(*) = 2 from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000003'),
  'the republished course still has exactly one row per canal'
);
select pg_temp.assert_true(
  (select bool_and(
     status = 'pending'
     and claim_generation = 4
     and completed_at is null
     and claimed_at is null
     and claim_token is null
     and created_at > now() - interval '1 minute'
   )
   from public.curso_anuncios
   where curso_id = '20000000-0000-4000-8000-000000000003'),
  'republishing revives both the email and the push terminal rows to pending, per-canal claim_generation incremented'
);

select '0022 canal push: PASS' as result;

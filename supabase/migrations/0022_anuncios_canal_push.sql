-- Extiende la cola de anuncios de curso (public.curso_anuncios) para que
-- drene un segundo canal, push, por la MISMA máquina de concurrencia que ya
-- usa email: claim-with-fencing-token, cursor resumible, backoff
-- exponencial, expiración a 7 días. No es un sistema paralelo: es la
-- diferencia entre "una fila por curso" y "una fila por (curso, canal)".
--
-- La primary key pasa de (curso_id) a (curso_id, canal): así claim_curso_anuncio
-- puede reclamar y bloquear el job de email y el de push del mismo curso de
-- forma completamente independiente (dos filas, dos `for update skip locked`
-- distintos), en vez de que ambos canales compitan por una sola fila.
--
-- destinatarios_curso_anuncio queda intacta: sigue siendo específica de
-- email. Un canal push necesita su propia fuente de destinatarios (tokens de
-- push, no perfiles con avisos_curso_nuevo) y esa función la agrega una
-- migración posterior, fuera de este alcance.
--
-- Todas las funciones que toman p_curso_id ahora también toman p_canal y
-- filtran por ambos, para no operar sobre el canal equivocado cuando las dos
-- filas de un mismo curso conviven. curso_anunciado(p_curso_id) mantiene su
-- firma (el panel de admin solo pregunta "¿ya se mandó el email?") pero
-- ahora filtra explícitamente canal = 'email'.
--
-- ROLLOUT EN DOS ETAPAS — esta migración es un no-op funcional para el
-- edge function desplegado hoy (supabase/functions/notify-course-published):
-- agrega toda la infraestructura de canal (columna, PK compuesta, encolado
-- dual, funciones de job por canal) pero claim_curso_anuncio() se deja
-- deliberadamente acotado a canal = 'email' únicamente. Las filas push se
-- encolan y quedan pending/suprimidas sin que nada las reclame. Motivo: el
-- edge function actual no manda p_canal ni distingue job.canal, así que si
-- reclamara filas push las procesaría como si fueran email (mandaría un
-- envío real por Resend) y después fallaría al persistir el cursor por la
-- firma nueva, dejando la fila trabada en 'processing' hasta que
-- claim_curso_anuncio() la vuelva a reclamar 5 minutos después — reenviando
-- el mismo batch de destinatarios indefinidamente. Una migración posterior,
-- de la mano del redeploy del edge function que sí branchee por job.canal,
-- va a sacar esa restricción y abrir el claim de push.
--
-- Reaplicar este archivo es seguro:
-- * `add column if not exists` / el DO block de la constraint de canal no
--   fallan si ya corrieron antes.
-- * El swap de primary key descubre el nombre real de la constraint vigente
--   en pg_constraint (no asume un nombre) y siempre termina en
--   curso_anuncios_pkey sobre (curso_id, canal); repetirlo es un no-op.
-- * El backfill de supresión usa `on conflict (curso_id, canal) do nothing`.
-- * Las funciones con firma nueva se borran por su firma vieja con
--   `drop function if exists` (no-op en la segunda corrida) y se recrean con
--   `create or replace` (idempotente en la firma nueva).

begin;

do $preflight$
begin
  if to_regclass('public.curso_anuncios') is null then
    raise exception using
      errcode = 'P0001',
      message = '0022 preflight failed: public.curso_anuncios is required';
  end if;

  if to_regprocedure('public.enqueue_curso_anuncio()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0022 preflight failed: public.enqueue_curso_anuncio() is required';
  end if;

  if to_regprocedure('public.claim_curso_anuncio()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0022 preflight failed: public.claim_curso_anuncio() is required';
  end if;

  if to_regprocedure('public.avanzar_curso_anuncio(uuid, uuid, bigint, uuid, integer)') is null then
    raise exception using
      errcode = 'P0001',
      message = '0022 preflight failed: public.avanzar_curso_anuncio(uuid, uuid, bigint, uuid, integer) is required';
  end if;

  if to_regprocedure('public.completar_curso_anuncio(uuid, uuid, bigint)') is null then
    raise exception using
      errcode = 'P0001',
      message = '0022 preflight failed: public.completar_curso_anuncio(uuid, uuid, bigint) is required';
  end if;

  if to_regprocedure('public.pausar_curso_anuncio(uuid, uuid, bigint)') is null then
    raise exception using
      errcode = 'P0001',
      message = '0022 preflight failed: public.pausar_curso_anuncio(uuid, uuid, bigint) is required';
  end if;

  if to_regprocedure('public.reintentar_curso_anuncio(uuid, uuid, bigint, text)') is null then
    raise exception using
      errcode = 'P0001',
      message = '0022 preflight failed: public.reintentar_curso_anuncio(uuid, uuid, bigint, text) is required';
  end if;

  if to_regprocedure('public.curso_anunciado(uuid)') is null then
    raise exception using
      errcode = 'P0001',
      message = '0022 preflight failed: public.curso_anunciado(uuid) is required';
  end if;
end
$preflight$;

-- 1. Columna canal. Default 'email' cubre las filas preexistentes: ya eran
--    todas de email, así que no hace falta un UPDATE aparte para ellas.
alter table public.curso_anuncios
  add column if not exists canal text not null default 'email';

do $canal_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.curso_anuncios'::regclass
      and conname = 'curso_anuncios_canal_valido'
  ) then
    alter table public.curso_anuncios
      add constraint curso_anuncios_canal_valido check (canal in ('email', 'push'));
  end if;
end
$canal_check$;

-- 2. Swap de primary key: (curso_id) -> (curso_id, canal). 0015 creó la tabla
--    con `curso_id uuid primary key ...` inline, sin nombre explícito, así
--    que Postgres la nombró con su convención por defecto: curso_anuncios_pkey.
--    No se asume ese nombre a ciegas: se lo busca en pg_constraint (contype =
--    'p') y se dropea el que exista, sea cual sea su nombre real, antes de
--    crear la nueva PK compuesta con nombre explícito curso_anuncios_pkey.
-- Se dropea y se recrea sin condicionales: repetir esto en una reaplicación
-- es un no-op en la práctica (la PK compuesta que queda es idéntica), así
-- que no hace falta comparar columnas para decidir si hace falta o no.
do $pk_swap$
declare
  pk_name text;
begin
  select conname into pk_name
  from pg_constraint
  where conrelid = 'public.curso_anuncios'::regclass
    and contype = 'p';

  if pk_name is null then
    raise exception using
      errcode = 'P0001',
      message = '0022 failed: public.curso_anuncios has no primary key to replace';
  end if;

  execute format('alter table public.curso_anuncios drop constraint %I', pk_name);
end
$pk_swap$;

alter table public.curso_anuncios
  add constraint curso_anuncios_pkey primary key (curso_id, canal);

-- 3. Ninguna otra tabla referencia curso_anuncios.curso_id por FK (verificado
--    con grep sobre supabase/migrations por "references public.curso_anuncios"
--    y por las apariciones de "curso_anuncios(" como target de FK: no hay
--    coincidencias fuera de este mismo archivo de definición). El swap de PK
--    no requiere tocar ninguna FK externa.

-- 4. Supresión: todo curso ya publicado al momento de aplicar esta migración
--    no debe generar un push retroactivo la primera vez que el drain corra
--    después de este deploy. Mismo patrón que 0015:87-91 para email; las
--    filas canal = 'email' preexistentes no se tocan acá (ya son 'sent' desde
--    antes y ya tienen canal = 'email' por el default de la columna nueva).
insert into public.curso_anuncios (curso_id, canal, status, completed_at)
select id, 'push', 'sent', now()
from public.cursos
where estado = 'publicado'
on conflict (curso_id, canal) do nothing;

-- 5. Funciones channel-aware.

create or replace function public.enqueue_curso_anuncio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.estado <> 'publicado' then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.estado = 'publicado' then
    return null;
  end if;

  -- Un solo INSERT con dos filas VALUES (email y push) en vez de dos
  -- sentencias separadas: el on conflict aplica fila por fila, así que el
  -- mismo comentario de reset de 0018 vale para ambos canales sin repetirlo.
  -- El `where` solo revive filas terminales (sent/failed/expired): una fila
  -- pending/processing/retry ya va camino a enviarse por ese canal, y
  -- resetearla en pleno vuelo le robaría el claim al worker activo.
  insert into public.curso_anuncios (curso_id, canal)
  values
    (new.id, 'email'),
    (new.id, 'push')
  on conflict (curso_id, canal) do update
    set status = 'pending',
        attempt_count = 0,
        error_count = 0,
        next_attempt_at = pg_catalog.clock_timestamp() + interval '10 minutes',
        claimed_at = null,
        claim_token = null,
        claim_generation = public.curso_anuncios.claim_generation + 1,
        ultimo_destinatario = null,
        destinatarios_enviados = 0,
        last_error = null,
        completed_at = null,
        created_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where public.curso_anuncios.status in ('sent', 'failed', 'expired');

  return null;
end
$function$;

-- claim_curso_anuncio agrega `canal` a las columnas devueltas: CREATE OR
-- REPLACE no permite cambiar el shape de un RETURNS TABLE (Postgres lo
-- rechaza con "cannot change return type of existing function"), así que hay
-- que borrar la función vieja primero. No tiene triggers ni otras funciones
-- SQL que dependan de ella, así que el drop es seguro.
drop function if exists public.claim_curso_anuncio();

create or replace function public.claim_curso_anuncio()
returns table (
  curso_id uuid,
  canal text,
  titulo text,
  claim_token uuid,
  claim_generation bigint,
  ultimo_destinatario uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate uuid;
  candidate_canal text;
  candidate_created_at timestamptz;
  candidate_ultimo uuid;
  candidate_estado text;
  candidate_titulo text;
  next_token uuid;
  next_generation bigint;
  next_attempt integer;
begin
  loop
    candidate := null;
    -- La selección del candidato SIGUE acotada a canal = 'email': es la
    -- restricción deliberada del rollout en dos etapas descripta en el
    -- header de este archivo. El edge function desplegado hoy no manda
    -- p_canal ni sabe leer job.canal, así que si esta query llegara a
    -- devolver una fila push, ese código la procesaría como si fuera email
    -- (Resend real de por medio) y después fallaría al persistir el cursor,
    -- dejándola trabada en 'processing' hasta el próximo reclamo por
    -- staleness — reenviando el mismo batch cada 5 minutos, sin límite.
    -- Sacar este filtro es responsabilidad de una migración posterior, en
    -- conjunto con el redeploy del edge function que branchee por canal.
    select queue.curso_id, queue.canal, queue.created_at, queue.ultimo_destinatario
    into candidate, candidate_canal, candidate_created_at, candidate_ultimo
    from public.curso_anuncios as queue
    where queue.canal = 'email'
      and (
        (
          queue.status in ('pending', 'retry')
          and queue.next_attempt_at <= pg_catalog.clock_timestamp()
        )
        or (
          queue.status = 'processing'
          and queue.claimed_at <= pg_catalog.clock_timestamp() - interval '5 minutes'
        )
      )
    order by queue.next_attempt_at, queue.created_at, queue.curso_id, queue.canal
    limit 1
    for update skip locked;

    if candidate is null then
      return;
    end if;

    if candidate_created_at < pg_catalog.clock_timestamp() - interval '7 days' then
      update public.curso_anuncios
      set status = 'expired',
          completed_at = pg_catalog.clock_timestamp(),
          updated_at = pg_catalog.clock_timestamp()
      where curso_anuncios.curso_id = candidate
        and curso_anuncios.canal = candidate_canal;
      continue;
    end if;

    candidate_estado := null;
    candidate_titulo := null;
    select cursos.estado, cursos.titulo
    into candidate_estado, candidate_titulo
    from public.cursos
    where cursos.id = candidate;

    if candidate_estado is distinct from 'publicado' then
      update public.curso_anuncios
      set status = 'expired',
          completed_at = pg_catalog.clock_timestamp(),
          updated_at = pg_catalog.clock_timestamp()
      where curso_anuncios.curso_id = candidate
        and curso_anuncios.canal = candidate_canal;
      continue;
    end if;

    next_token := pg_catalog.gen_random_uuid();
    update public.curso_anuncios as queue
    set status = 'processing',
        attempt_count = queue.attempt_count + 1,
        claimed_at = pg_catalog.clock_timestamp(),
        claim_token = next_token,
        claim_generation = queue.claim_generation + 1,
        updated_at = pg_catalog.clock_timestamp()
    where queue.curso_id = candidate
      and queue.canal = candidate_canal
    returning queue.attempt_count, queue.claim_generation
      into next_attempt, next_generation;

    curso_id := candidate;
    canal := candidate_canal;
    titulo := candidate_titulo;
    claim_token := next_token;
    claim_generation := next_generation;
    ultimo_destinatario := candidate_ultimo;
    attempt_count := next_attempt;
    return next;
    return;
  end loop;
end
$function$;

-- destinatarios_curso_anuncio(uuid, integer) NO se toca: sigue siendo
-- específica del canal email (filtra por avisos_curso_nuevo). Un canal push
-- necesita su propia fuente de destinatarios; queda para otra migración.

drop function if exists public.avanzar_curso_anuncio(uuid, uuid, bigint, uuid, integer);

-- p_canal default 'email', al final de la lista: defensa en profundidad
-- para el rollout en dos etapas. Como claim_curso_anuncio() ahora solo
-- devuelve filas canal = 'email', el caller que no manda p_canal explícito
-- (el edge function desplegado hoy, que llama con argumentos nombrados y
-- nunca incluye p_canal) siempre está operando sobre la fila que
-- efectivamente reclamó. El default vuelve explícito ese supuesto
-- ya-verdadero y mantiene a esas funciones invocables tal cual las llama el
-- edge function actual, sin romperlo mientras dura el rollout. Postgres
-- exige que un parámetro con default no sea seguido de uno sin default, por
-- eso p_canal se corre al final en vez de mantenerse en su posición
-- original; los callers por nombre (PostgREST/supabase-js) no dependen del
-- orden posicional.
create or replace function public.avanzar_curso_anuncio(
  p_curso_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_ultimo uuid,
  p_enviados integer,
  p_canal text default 'email'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed integer;
begin
  update public.curso_anuncios
  set ultimo_destinatario = p_ultimo,
      destinatarios_enviados = destinatarios_enviados + p_enviados,
      updated_at = pg_catalog.clock_timestamp()
  where curso_id = p_curso_id
    and canal = p_canal
    and status = 'processing'
    and claim_token = p_claim_token
    and claim_generation = p_claim_generation;

  get diagnostics changed = row_count;
  return changed = 1;
end
$function$;

drop function if exists public.completar_curso_anuncio(uuid, uuid, bigint);

-- p_canal default 'email' al final: mismo motivo que avanzar_curso_anuncio
-- arriba (rollout en dos etapas, callers por nombre no dependen del orden).
create or replace function public.completar_curso_anuncio(
  p_curso_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_canal text default 'email'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed integer;
begin
  -- Conserva exactamente la corrección de 0016: al pasar a 'sent' hay que
  -- limpiar claimed_at/claim_token, o curso_anuncios_claim_consistent aborta
  -- el UPDATE entero y la fila queda trabada en 'processing' para siempre.
  update public.curso_anuncios
  set status = 'sent',
      completed_at = pg_catalog.clock_timestamp(),
      claimed_at = null,
      claim_token = null,
      updated_at = pg_catalog.clock_timestamp()
  where curso_id = p_curso_id
    and canal = p_canal
    and status = 'processing'
    and claim_token = p_claim_token
    and claim_generation = p_claim_generation;

  get diagnostics changed = row_count;
  return changed = 1;
end
$function$;

drop function if exists public.pausar_curso_anuncio(uuid, uuid, bigint);

-- p_canal default 'email' al final: mismo motivo que avanzar_curso_anuncio
-- arriba (rollout en dos etapas, callers por nombre no dependen del orden).
create or replace function public.pausar_curso_anuncio(
  p_curso_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_canal text default 'email'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed integer;
begin
  -- Pausa por presupuesto de tiempo, no un fallo: no toca error_count.
  update public.curso_anuncios
  set status = 'retry',
      next_attempt_at = pg_catalog.clock_timestamp(),
      claimed_at = null,
      claim_token = null,
      updated_at = pg_catalog.clock_timestamp()
  where curso_id = p_curso_id
    and canal = p_canal
    and status = 'processing'
    and claim_token = p_claim_token
    and claim_generation = p_claim_generation;

  get diagnostics changed = row_count;
  return changed = 1;
end
$function$;

drop function if exists public.reintentar_curso_anuncio(uuid, uuid, bigint, text);

-- p_canal default 'email' al final: mismo motivo que avanzar_curso_anuncio
-- arriba (rollout en dos etapas, callers por nombre no dependen del orden).
create or replace function public.reintentar_curso_anuncio(
  p_curso_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_sanitized_error text,
  p_canal text default 'email'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed integer;
begin
  update public.curso_anuncios as queue
  set status = case when queue.error_count + 1 >= 8 then 'failed' else 'retry' end,
      completed_at = case
        when queue.error_count + 1 >= 8 then pg_catalog.clock_timestamp()
        else null
      end,
      next_attempt_at = case
        when queue.error_count + 1 >= 8 then queue.next_attempt_at
        else pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(
            secs => least(3600, 30 * power(2, least(queue.error_count, 7)))::integer
          )
      end,
      claimed_at = null,
      claim_token = null,
      error_count = queue.error_count + 1,
      last_error = left(coalesce(p_sanitized_error, 'send_failed'), 160),
      updated_at = pg_catalog.clock_timestamp()
  where queue.curso_id = p_curso_id
    and queue.canal = p_canal
    and queue.status = 'processing'
    and queue.claim_token = p_claim_token
    and queue.claim_generation = p_claim_generation;

  get diagnostics changed = row_count;
  return changed = 1;
end
$function$;

-- 6. curso_anunciado mantiene su firma (p_curso_id uuid): al admin le importa
--    si el EMAIL ya salió, no el estado del push. Se acota explícitamente a
--    canal = 'email' para no quedar acoplado a que sea el único canal en la
--    tabla.
create or replace function public.curso_anunciado(p_curso_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.es_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return exists (
    select 1
    from public.curso_anuncios
    where curso_id = p_curso_id and canal = 'email' and status = 'sent'
  );
end
$function$;

-- 7. Grants: solo las funciones cuya firma cambió (o que se borraron y se
--    recrearon, lo que también borra sus grants) necesitan reaplicarse.
--    enqueue_curso_anuncio() y curso_anunciado(uuid) no cambiaron de firma y
--    no se borraron, así que sus grants de 0015/0018 siguen vigentes tal
--    cual.
-- Las firmas de tipos reflejan el orden real de parámetros: p_canal se
-- corre al final (con default 'email') en cada una, ver comentario junto a
-- cada create or replace más arriba.
revoke all on function public.claim_curso_anuncio() from public, anon, authenticated;
revoke all on function public.avanzar_curso_anuncio(uuid, uuid, bigint, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.completar_curso_anuncio(uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.pausar_curso_anuncio(uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.reintentar_curso_anuncio(uuid, uuid, bigint, text, text) from public, anon, authenticated;

grant execute on function public.claim_curso_anuncio() to service_role;
grant execute on function public.avanzar_curso_anuncio(uuid, uuid, bigint, uuid, integer, text) to service_role;
grant execute on function public.completar_curso_anuncio(uuid, uuid, bigint, text) to service_role;
grant execute on function public.pausar_curso_anuncio(uuid, uuid, bigint, text) to service_role;
grant execute on function public.reintentar_curso_anuncio(uuid, uuid, bigint, text, text) to service_role;

commit;

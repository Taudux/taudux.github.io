-- Aviso por correo cuando se publica un curso nuevo. Este archivo SOLO
-- ENCOLA: el trigger sobre public.cursos inserta una fila durable en
-- public.curso_anuncios, pero ningún correo se envía desde SQL. No hay
-- scheduler instalado por esta migración; el drenaje de la cola (reclamar,
-- iterar destinatarios, enviar) lo hace una edge function externa que llama
-- a las funciones service_role definidas aquí.
--
-- Aplicar dos veces es seguro: la cola es idempotente por diseño (primary
-- key por curso_id, `on conflict do nothing` en el encolado y en el
-- backfill de supresión).

begin;

do $preflight$
begin
  if to_regclass('public.cursos') is null then
    raise exception using
      errcode = 'P0001',
      message = '0015 preflight failed: public.cursos is required';
  end if;

  if to_regclass('public.perfiles') is null then
    raise exception using
      errcode = 'P0001',
      message = '0015 preflight failed: public.perfiles is required';
  end if;

  if to_regprocedure('public.es_admin()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0015 preflight failed: public.es_admin() is required';
  end if;
end
$preflight$;

alter table public.perfiles
  add column avisos_curso_nuevo boolean not null default true;

grant update (avisos_curso_nuevo) on public.perfiles to authenticated;

create table public.curso_anuncios (
  curso_id uuid primary key references public.cursos (id) on delete cascade,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  error_count integer not null default 0,
  next_attempt_at timestamptz not null default (now() + interval '10 minutes'),
  claimed_at timestamptz,
  claim_token uuid,
  claim_generation bigint not null default 0,
  ultimo_destinatario uuid,
  destinatarios_enviados integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint curso_anuncios_status_valid
    check (status in ('pending', 'processing', 'retry', 'sent', 'failed', 'expired')),
  constraint curso_anuncios_claim_consistent
    check (
      (status = 'processing') = (claimed_at is not null and claim_token is not null)
    ),
  constraint curso_anuncios_terminal_consistent
    check (
      (status in ('sent', 'failed', 'expired')) = (completed_at is not null)
    ),
  constraint curso_anuncios_counters_valid
    check (attempt_count >= 0 and error_count >= 0 and destinatarios_enviados >= 0),
  constraint curso_anuncios_generation_valid
    check (claim_generation >= 0),
  constraint curso_anuncios_last_error_bounded
    check (last_error is null or char_length(last_error) <= 160)
);

create index curso_anuncios_pendientes_idx
  on public.curso_anuncios (next_attempt_at)
  where status in ('pending', 'retry', 'processing');

alter table public.curso_anuncios enable row level security;
alter table public.curso_anuncios force row level security;

revoke all on table public.curso_anuncios from public, anon, authenticated;
grant select, insert, update, delete on table public.curso_anuncios to service_role;

-- Supresión: ningún curso ya publicado al momento de aplicar esta migración
-- puede anunciarse. Va ANTES de crear el trigger para que no exista ventana
-- en la que el trigger pueda encolar un curso ya cubierto por este backfill.
insert into public.curso_anuncios (curso_id, status, completed_at)
select id, 'sent', now()
from public.cursos
where estado = 'publicado'
on conflict (curso_id) do nothing;

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

  insert into public.curso_anuncios (curso_id)
  values (new.id)
  on conflict (curso_id) do nothing;

  return null;
end
$function$;

create or replace function public.claim_curso_anuncio()
returns table (
  curso_id uuid,
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
    select queue.curso_id, queue.created_at, queue.ultimo_destinatario
    into candidate, candidate_created_at, candidate_ultimo
    from public.curso_anuncios as queue
    where (
        (
          queue.status in ('pending', 'retry')
          and queue.next_attempt_at <= pg_catalog.clock_timestamp()
        )
        or (
          queue.status = 'processing'
          and queue.claimed_at <= pg_catalog.clock_timestamp() - interval '5 minutes'
        )
      )
    order by queue.next_attempt_at, queue.created_at, queue.curso_id
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
      where curso_anuncios.curso_id = candidate;
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
      where curso_anuncios.curso_id = candidate;
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
    returning queue.attempt_count, queue.claim_generation
      into next_attempt, next_generation;

    curso_id := candidate;
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

create or replace function public.destinatarios_curso_anuncio(desde uuid, limite integer)
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.id, u.email
  from public.perfiles p
  join auth.users u on u.id = p.id
  where p.avisos_curso_nuevo
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and p.id > coalesce(desde, '00000000-0000-0000-0000-000000000000'::uuid)
  order by p.id
  limit limite;
$function$;

create or replace function public.avanzar_curso_anuncio(
  p_curso_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_ultimo uuid,
  p_enviados integer
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
    and status = 'processing'
    and claim_token = p_claim_token
    and claim_generation = p_claim_generation;

  get diagnostics changed = row_count;
  return changed = 1;
end
$function$;

create or replace function public.completar_curso_anuncio(
  p_curso_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint
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
  set status = 'sent',
      completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where curso_id = p_curso_id
    and status = 'processing'
    and claim_token = p_claim_token
    and claim_generation = p_claim_generation;

  get diagnostics changed = row_count;
  return changed = 1;
end
$function$;

create or replace function public.pausar_curso_anuncio(
  p_curso_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint
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
    and status = 'processing'
    and claim_token = p_claim_token
    and claim_generation = p_claim_generation;

  get diagnostics changed = row_count;
  return changed = 1;
end
$function$;

create or replace function public.reintentar_curso_anuncio(
  p_curso_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_sanitized_error text
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
    and queue.status = 'processing'
    and queue.claim_token = p_claim_token
    and queue.claim_generation = p_claim_generation;

  get diagnostics changed = row_count;
  return changed = 1;
end
$function$;

create trigger cursos_enqueue_anuncio
  after insert or update of estado on public.cursos
  for each row execute function public.enqueue_curso_anuncio();

revoke all on function public.enqueue_curso_anuncio() from public, anon, authenticated;
revoke all on function public.claim_curso_anuncio() from public, anon, authenticated;
revoke all on function public.destinatarios_curso_anuncio(uuid, integer) from public, anon, authenticated;
revoke all on function public.avanzar_curso_anuncio(uuid, uuid, bigint, uuid, integer) from public, anon, authenticated;
revoke all on function public.completar_curso_anuncio(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.pausar_curso_anuncio(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.reintentar_curso_anuncio(uuid, uuid, bigint, text) from public, anon, authenticated;

grant execute on function public.claim_curso_anuncio() to service_role;
grant execute on function public.destinatarios_curso_anuncio(uuid, integer) to service_role;
grant execute on function public.avanzar_curso_anuncio(uuid, uuid, bigint, uuid, integer) to service_role;
grant execute on function public.completar_curso_anuncio(uuid, uuid, bigint) to service_role;
grant execute on function public.pausar_curso_anuncio(uuid, uuid, bigint) to service_role;
grant execute on function public.reintentar_curso_anuncio(uuid, uuid, bigint, text) to service_role;

commit;

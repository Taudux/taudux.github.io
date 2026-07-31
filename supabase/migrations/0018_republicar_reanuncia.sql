-- Publicar un curso siempre reencola su aviso, incluso si ya fue anunciado
-- antes. 0015 encolaba con `on conflict (curso_id) do nothing`: una vez que
-- existía la fila para un curso, ningún cambio de estado posterior volvía a
-- avisar. Combinado con la expiración de claim_curso_anuncio (0015:162-185,
-- que marca `expired` un anuncio si el curso ya no está publicado cuando el
-- worker lo procesa), archivar un curso dentro de los 10 minutos posteriores
-- a publicarlo dejaba el anuncio `expired` para siempre: republicar no lo
-- revivía y el curso salía al público sin que nadie se enterara.
--
-- Archivar y republicar ahora reenvía a todos los suscritos. Es intencional:
-- publicar deja de ser una acción silenciosa y pasa a requerir confirmación
-- explícita en el cliente (ver confirm-dialog.js y cursoYaAnunciado más abajo).
--
-- Aplicar dos veces es seguro: create or replace function es idempotente, y
-- el `where` del upsert solo toca filas en estado terminal.

begin;

do $preflight$
begin
  if to_regclass('public.curso_anuncios') is null then
    raise exception using
      errcode = 'P0001',
      message = '0018 preflight failed: public.curso_anuncios is required';
  end if;

  if to_regprocedure('public.es_admin()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0018 preflight failed: public.es_admin() is required';
  end if;
end
$preflight$;

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

  -- El `where` solo revive filas terminales (sent/failed/expired): una fila
  -- pending/processing/retry ya va camino a enviarse, y resetearla en pleno
  -- vuelo le robaría el claim al worker activo y reenviaría a destinatarios
  -- que ese mismo run ya procesó. No es una excepción a "siempre se avisa":
  -- ese anuncio ya está saliendo.
  --
  -- claim_generation se incrementa, nunca se resetea a 0: es el fencing token
  -- que avanzar_curso_anuncio/completar_curso_anuncio comparan contra un
  -- worker viejo. Volverlo a 0 dejaría a un run zombi escribir sobre el nuevo.
  --
  -- created_at se resetea porque claim_curso_anuncio (0015:162) expira
  -- cualquier anuncio con más de 7 días; sin este reset, revivir un curso
  -- viejo nacería vencido.
  insert into public.curso_anuncios (curso_id)
  values (new.id)
  on conflict (curso_id) do update
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

-- Expone a los admins si un curso ya envió su aviso (status = 'sent'), sin
-- levantar el `revoke all` de 0015 sobre curso_anuncios: el cliente nunca lee
-- la tabla directo. Lo que le importa al admin es si la gente ya recibió el
-- correo, no si hubo un intento, por eso el filtro es 'sent' y no "existe".
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
    where curso_id = p_curso_id and status = 'sent'
  );
end
$function$;

revoke all on function public.curso_anunciado(uuid) from public, anon;
grant execute on function public.curso_anunciado(uuid) to authenticated;

commit;

-- Quita la ventana de gracia de 10 minutos entre publicar un curso y avisar.
--
-- 0015 introdujo ese retraso como red de seguridad: daba diez minutos para
-- despublicar un curso mal cargado antes de que el aviso saliera a todos los
-- suscriptores. Decisión explícita de producto: se prefiere que el anuncio
-- salga en el primer barrido del cron (hasta 5 minutos, por `*/5 * * * *` en
-- 0019) y se acepta perder ese margen de arrepentimiento. Publicar pasa a ser
-- irreversible respecto del aviso.
--
-- Hay DOS lugares que imponían el retraso y los dos hacen falta:
--   1. El default de la columna next_attempt_at (0015:46), que cubre el alta
--      de un curso publicado por primera vez.
--   2. El `on conflict do update` de enqueue_curso_anuncio (0022:200), que
--      cubre republicar un curso archivado y llevaba su propio + interval
--      '10 minutes' hardcodeado.
-- Tocar sólo uno deja la mitad de los casos esperando.
--
-- Lo que esta migración NO toca: el backoff de reintentos de
-- reintentar_curso_anuncio (0022:483), que empuja next_attempt_at con
-- 30 * 2^error_count segundos. Ésa es una espera distinta -- separa dos
-- intentos fallidos contra Resend o Expo, no publicación de aviso. Aplanarla
-- convertiría cada fallo de envío en un bucle cerrado martillando al
-- proveedor, que es justo el reenvío en loop que este trabajo vino a cerrar.
--
-- Aplicar dos veces es seguro: un alter column set default idempotente y un
-- create or replace. No hay backfill ni estado mutable.

begin;

do $preflight$
begin
  if to_regclass('public.curso_anuncios') is null then
    raise exception using
      errcode = 'P0001',
      message = '0024 preflight failed: public.curso_anuncios is required (apply 0015 first)';
  end if;

  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.curso_anuncios'::regclass
      and attname = 'canal'
      and not attisdropped
  ) then
    raise exception using
      errcode = 'P0001',
      message = '0024 preflight failed: public.curso_anuncios.canal is required (apply 0022 first)';
  end if;
end
$preflight$;

-- 1. Alta de un curso publicado por primera vez.
alter table public.curso_anuncios
  alter column next_attempt_at set default now();

-- 2. Republicación de un curso archivado.
--
-- Copia literal de la versión de 0022 salvo por next_attempt_at en el
-- `on conflict do update`. Todo lo demás -- el guard de estado, el guard de
-- UPDATE sobre un curso que ya estaba publicado, las dos filas VALUES por
-- canal y el `where` que sólo revive filas terminales -- se conserva igual.
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
        next_attempt_at = pg_catalog.clock_timestamp(),
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

commit;

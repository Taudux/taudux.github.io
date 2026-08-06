-- El canal email deja de recibir trabajos de la cola de anuncios de curso.
-- Publicar (o republicar) un curso a partir de ahora encola UNA sola fila,
-- canal = 'push'. Esto es política de producto PERMANENTE, no un toggle por
-- publicación: no hay flag, no hay columna de configuración, no hay forma de
-- pedir "este curso sí avisa por email". Si el negocio decide reabrir el
-- canal email más adelante, eso es una migración nueva con su propia
-- justificación explícita -- no una reversión mecánica de ésta.
--
-- Lo que esta migración NO hace: no borra la maquinaria de email. Sigue
-- existiendo intacta -- destinatarios_curso_anuncio (0015), enviarEmail.ts,
-- paraEmail y el branch de email del edge function -- porque se extrajo la
-- semana pasada a _shared/ justamente para que la reutilicen futuros
-- remitentes que todavía no existen (welcome email, recordatorios). Esa
-- maquinaria simplemente deja de recibir trabajos DESDE ESTA cola: no hay
-- filas canal = 'email' nuevas que la alimenten. El edge function no
-- necesita ningún cambio para este despliegue: ya branchea por job.canal
-- desde 0023, así que un canal que deja de aparecer en la cola es, para ese
-- código, indistinguible de "hoy no hay nada de ese canal para procesar".
--
-- curso_anunciado(uuid) se repuntea con enqueue_curso_anuncio() en el mismo
-- archivo porque son la misma decisión mirada desde dos lados. Si
-- curso_anunciado siguiera preguntando por canal = 'email' después de esta
-- migración, jamás encontraría una fila 'sent' de ese canal (ya no se crean
-- filas nuevas) y devolvería false para siempre -- el diálogo de
-- confirmación del panel de admin diría "nunca anunciado" cada vez que se
-- republique un curso que en los hechos ya avisó por push. El predicado pasa
-- a canal = 'push' explícito, no "cualquier canal": una fila email vieja en
-- 'sent' (de antes de esta migración) no puede marcar como anunciado un
-- curso cuyo push todavía no salió. Esto no genera falsos negativos
-- históricos: todo curso publicado antes de 0022 ya tiene su fila push en
-- 'sent' desde el backfill de supresión de esa misma migración (0022:163-167),
-- así que no hay ningún curso legítimamente anunciado que esta migración
-- deje sin forma de probarlo.
--
-- La UPDATE de supresión al final de este archivo cierra las filas email que
-- siguen vivas en la cola al momento de aplicar esto. Hace falta porque
-- claim_curso_anuncio() es channel-agnostic desde 0023 (ya no filtra por
-- canal): sin cerrar estas filas, el próximo barrido de pg_cron (0019,
-- */5 * * * *) reclama una fila email pendiente igual que reclama una push,
-- y sale un correo real minutos después de que la política dice que no debía
-- salir ninguno más.
--
-- Por qué 'expired' y no otro status terminal: 'sent' mentiría (nada se
-- entregó). 'failed' implica ocho fallos de envío consecutivos y dispararía
-- el monitoreo de salud del proveedor sobre un correo que ni siquiera se
-- intentó. 'expired' ya significa exactamente esto en el resto del sistema
-- -- "la cola cerró esta fila sin entregarla" -- es el mismo status que usan
-- la expiración por antigüedad de 7 días y la limpieza al despublicar; no
-- hace falta inventar un status nuevo para una razón de cierre nueva.
-- last_error queda en 'email_channel_retired' para que un operador que mire
-- la tabla más adelante pueda distinguir a simple vista una fila cerrada por
-- esta política de una que expiró por vieja.
--
-- La UPDATE respeta los dos constraints de 0015 explícitamente:
--   * curso_anuncios_terminal_consistent exige completed_at no nulo para
--     todo status terminal (sent/failed/expired) -- por eso se setea acá.
--   * curso_anuncios_claim_consistent exige claimed_at/claim_token en null
--     en cuanto el status deja de ser 'processing' -- es exactamente el fix
--     de 0016 (0016:69-76: la misma idea de cerrar una fila liberando su
--     claim en el mismo UPDATE, para no violar el propio constraint).
--     Omitir cualquiera de las dos aborta la sentencia entera.
--
-- El `where` incluye 'processing' además de 'pending' y 'retry' por dos
-- motivos: cierra una fila que un worker tiene agarrada en este mismo
-- instante, y bajo READ COMMITTED también cubre el caso de una fila que
-- pasa de pending a processing por un claim concurrente mientras esta UPDATE
-- espera el lock de esa fila -- el snapshot de la sentencia ve el valor ya
-- actualizado, así que igual la alcanza.
--
-- Por qué no rompe al worker que ya tiene la fila en vuelo: avanzar_,
-- completar_, pausar_ y reintentar_curso_anuncio filtran todos por
-- `status = 'processing' and claim_token = ... and claim_generation = ...`.
-- Contra una fila que esta migración ya dejó en 'expired', ese `where` no
-- matchea ninguna fila -- el UPDATE afecta cero filas, la función devuelve
-- false, y el caller lo trata como el mismo "alguien más ya tocó esta fila"
-- que ya maneja hoy (claim robado por staleness, etc). No hay violación de
-- constraint ni re-claim posible: una fila 'expired' no entra al `where` de
-- candidatos de claim_curso_anuncio.
--
-- claim_generation deliberadamente NO se incrementa acá. Precedente: la
-- UPDATE de cierre de 0016 (0016:69-76) tampoco lo toca. Incrementar
-- claim_generation es el idioma de REVIVIR una fila (0018, y el `on conflict
-- do update` de enqueue_curso_anuncio en 0022/0024) -- significa "esta fila
-- vuelve a jugar, invalidá cualquier claim_token viejo dando vueltas". Cerrar
-- una fila es lo opuesto: no hace falta invalidar nada porque nadie va a
-- volver a operar sobre ella.
--
-- Las filas email que ya estaban en sent/failed/expired no se tocan: son
-- registro histórico de lo que efectivamente salió (o no) por ese canal
-- antes de este cambio de política, y no hay ninguna razón para reescribir
-- historia.
--
-- Grants: no hace falta reotorgar nada. Ni enqueue_curso_anuncio() ni
-- curso_anunciado(uuid) cambian de firma ni se borran (create or replace
-- sobre la firma existente), así que conservan los grants que ya tenían
-- desde 0015/0018.
--
-- Reaplicar este archivo es seguro: los dos create or replace son
-- idempotentes por definición, y la UPDATE de supresión sobre una segunda
-- corrida no encuentra filas canal = 'email' en pending/processing/retry
-- (la primera corrida ya las cerró todas), así que no hace nada.

begin;

do $preflight$
begin
  if to_regclass('public.curso_anuncios') is null then
    raise exception using
      errcode = 'P0001',
      message = '0026 preflight failed: public.curso_anuncios is required (apply 0015 first)';
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
      message = '0026 preflight failed: public.curso_anuncios.canal is required (apply 0022 first)';
  end if;

  if to_regprocedure('public.enqueue_curso_anuncio()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0026 preflight failed: public.enqueue_curso_anuncio() is required';
  end if;

  if to_regprocedure('public.curso_anunciado(uuid)') is null then
    raise exception using
      errcode = 'P0001',
      message = '0026 preflight failed: public.curso_anunciado(uuid) is required';
  end if;
end
$preflight$;

-- Publicar (o republicar) un curso encola UNA sola fila, canal = 'push'. La
-- fila email deja de generarse acá: es el único cambio real respecto de la
-- versión de 0024. El resto -- ambos guards de estado, el on conflict con su
-- reset de 13 columnas, el `where` que sólo revive filas terminales y
-- pg_catalog.clock_timestamp() sin ventana de gracia -- se conserva igual.
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

  insert into public.curso_anuncios (curso_id, canal)
  values
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

-- curso_anunciado ahora refleja el canal push: es el único que sigue
-- recibiendo trabajos nuevos desde esta migración. Mismo guard de
-- es_admin(), misma firma, mismo `stable security definer set search_path =
-- ''` de la versión de 0022 -- el único cambio es el canal del predicado.
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
    where curso_id = p_curso_id and canal = 'push' and status = 'sent'
  );
end
$function$;

-- Cierra cualquier fila email que siga viva en la cola al momento de aplicar
-- esta migración, para que el próximo barrido de pg_cron no la reclame y
-- mande un correo real después de que la política ya dijo que no debía salir
-- ninguno más. Ver el comentario largo al inicio del archivo para el detalle
-- de cada decisión (status, constraints, por qué no bump de
-- claim_generation, por qué incluye 'processing').
update public.curso_anuncios
   set status = 'expired',
       completed_at = pg_catalog.clock_timestamp(),
       claimed_at = null,
       claim_token = null,
       last_error = 'email_channel_retired',
       updated_at = pg_catalog.clock_timestamp()
 where canal = 'email'
   and status in ('pending', 'processing', 'retry');

commit;

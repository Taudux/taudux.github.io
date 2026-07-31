-- Corrige un bug de 0015: completar_curso_anuncio cambiaba el status a 'sent'
-- sin limpiar claimed_at/claim_token. El constraint
-- curso_anuncios_claim_consistent exige que esos dos campos queden en null en
-- cuanto el status deja de ser 'processing', así que ese UPDATE violaba su
-- propio constraint, Postgres lo abortaba entero, y la fila quedaba trabada en
-- 'processing' indefinidamente: cada 5 minutos la reclamaba de nuevo por claim
-- rancia y volvía a fallar igual.
--
-- El correo ya se manda ANTES de este paso, así que el bug nunca duplicó un
-- envío ni perdió uno: solo impedía que la cola cerrara la fila.
--
-- pausar_curso_anuncio y reintentar_curso_anuncio ya limpiaban estos campos
-- correctamente; era un olvido puntual en completar_curso_anuncio.

begin;

do $preflight$
begin
  if to_regprocedure('public.completar_curso_anuncio(uuid, uuid, bigint)') is null then
    raise exception using
      errcode = 'P0001',
      message = '0016 preflight failed: public.completar_curso_anuncio(uuid, uuid, bigint) is required';
  end if;
end
$preflight$;

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

revoke all on function public.completar_curso_anuncio(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.completar_curso_anuncio(uuid, uuid, bigint) to service_role;

/*
  Cierra las filas que el bug dejó trabadas. Se marcan como 'sent' y no como
  'retry' a propósito: llegar a 'processing' con error_count = 0 significa que
  el envío a Resend ya había respondido 2xx y el único paso que faltaba era
  este cierre. Reencolarlas mandaría el correo por segunda vez a gente que ya
  lo recibió.

  Las filas con error_count > 0 sí vuelven a 'retry': ahí el fallo fue del
  envío, no del cierre, y corresponde reintentarlas.
*/
update public.curso_anuncios
set status = case when error_count = 0 then 'sent' else 'retry' end,
    completed_at = case when error_count = 0 then now() else null end,
    next_attempt_at = case when error_count = 0 then next_attempt_at else now() end,
    claimed_at = null,
    claim_token = null,
    updated_at = now()
where status = 'processing';

commit;

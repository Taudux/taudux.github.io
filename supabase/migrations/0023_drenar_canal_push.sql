-- Notificaciones push: paso final. Abre el canal `push` de la cola de
-- anuncios, que 0022 dejó encolando filas que nadie reclamaba.
--
-- 0022 agregó la dimensión `canal` y empezó a encolar una fila push por
-- curso publicado, pero dejó claim_curso_anuncio() acotada a canal =
-- 'email' a propósito: el edge function desplegado en ese momento no sabía
-- leer job.canal, y una fila push llegando a ese código habría salido por
-- Resend como si fuera un correo. Esta migración levanta ese filtro y agrega
-- la fuente de destinatarios que el canal push necesita.
--
-- ORDEN DE DESPLIEGUE, no invertible: el edge function que branchea por
-- canal tiene que estar YA desplegado antes de aplicar este archivo. Entre
-- "claim empieza a devolver filas push" y "el código sabe qué hacer con
-- ellas" no puede haber ventana; si la hay, se reproduce exactamente el
-- reenvío en bucle que 0022 evitó.
--
-- Aplicar dos veces es seguro: solo hay create or replace y grants
-- idempotentes. No hay backfill ni estado mutable que limpiar.

begin;

do $preflight$
begin
  if to_regclass('public.curso_anuncios') is null then
    raise exception using
      errcode = 'P0001',
      message = '0023 preflight failed: public.curso_anuncios is required (apply 0022 first)';
  end if;

  if to_regclass('public.push_devices') is null then
    raise exception using
      errcode = 'P0001',
      message = '0023 preflight failed: public.push_devices is required (apply 0021 first)';
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
      message = '0023 preflight failed: public.curso_anuncios.canal is required (apply 0022 first)';
  end if;
end
$preflight$;

-- 1. Fuente de destinatarios del canal push.
--
-- Espeja a destinatarios_curso_anuncio (0015) en filtros y contrato de
-- paginación, con dos diferencias deliberadas:
--
-- (a) LA PAGINACIÓN CUENTA USUARIOS, NO FILAS. El CTE aplica el `limit`
--     sobre los usuarios y recién después hace el join con push_devices. Sin
--     eso, un usuario con tres dispositivos consumiría tres lugares de la
--     página y el resto de sus tokens quedaría partido entre dos páginas —
--     pero el cursor avanza por usuario, así que la segunda página arrancaría
--     DESPUÉS de él y esos tokens no se enviarían nunca.
--
-- (b) LEFT JOIN, no inner. Un usuario suscripto que no instaló la app vuelve
--     igual, con expo_push_token en null. Eso es lo que mantiene honesto el
--     contrato "length < limite significa última página": con un inner join,
--     una página entera de usuarios sin app devolvería cero filas, el worker
--     la leería como fin de la lista, y cerraría el anuncio salteándose a
--     todos los suscriptores que vienen después. Filtrar los nulls es
--     responsabilidad del caller (esTokenExpoValido), igual que ya filtra
--     correos rotos con esEmailValido.
create or replace function public.destinatarios_push_curso_anuncio(desde uuid, limite integer)
returns table (id uuid, expo_push_token text)
language sql
stable
security definer
set search_path = ''
as $function$
  with pagina as (
    select p.id
    from public.perfiles p
    join auth.users u on u.id = p.id
    where p.avisos_curso_nuevo
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and p.id > coalesce(desde, '00000000-0000-0000-0000-000000000000'::uuid)
    order by p.id
    limit limite
  )
  select pagina.id, d.expo_push_token
  from pagina
  left join public.push_devices d on d.user_id = pagina.id
  order by pagina.id, d.expo_push_token;
$function$;

-- 2. claim_curso_anuncio() deja de estar acotada a canal = 'email'.
--
-- Es una copia literal de la versión de 0022 salvo por el `where` de
-- selección del candidato, que ahora considera ambos canales. El resto
-- (expiración por antigüedad, verificación de que el curso siga publicado,
-- generación del claim token) ya era channel-aware desde 0022.
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
    -- Sin filtro de canal: el edge function ya branchea por job.canal y sabe
    -- mandar cada fila por su proveedor. El `order by` mantiene canal como
    -- último criterio de desempate, así que dos filas del mismo curso
    -- encoladas a la vez salen en orden estable en vez de competir.
    select queue.curso_id, queue.canal, queue.created_at, queue.ultimo_destinatario
    into candidate, candidate_canal, candidate_created_at, candidate_ultimo
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

-- 3. Grants: mismo criterio que destinatarios_curso_anuncio en 0015. Solo el
--    worker de drenaje la invoca. Dejarla accesible a authenticated
--    permitiría a cualquier sesión enumerar los tokens push del proyecto
--    entero, que es justo lo que la RLS de push_devices impide por fila.
revoke all on function public.destinatarios_push_curso_anuncio(uuid, integer) from public, anon, authenticated;
grant execute on function public.destinatarios_push_curso_anuncio(uuid, integer) to service_role;

commit;

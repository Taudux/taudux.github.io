-- Eventos de negocio (altas y bajas de cuenta). Tabla de hechos MÍNIMA y
-- append-only: no reemplaza a public.perfiles, la complementa registrando el
-- HECHO, que debe sobrevivir al borrado de la cuenta. perfiles responde
-- "quién está"; esta tabla responde "qué pasó". No es un data warehouse: se
-- consulta con select/group by directo.
--
-- Aplicar dos veces NO es seguro (create table sin if not exists), pero no
-- hay estado mutable aparte del backfill inicial: un reintento tras un fallo
-- a mitad de camino sobre una base que nunca llegó a tener la tabla es un
-- re-run limpio.

begin;

do $preflight$
begin
  if to_regclass('auth.users') is null then
    raise exception using
      errcode = 'P0001',
      message = '0027 preflight failed: auth.users is required';
  end if;

  if to_regclass('public.perfiles') is null then
    raise exception using
      errcode = 'P0001',
      message = '0027 preflight failed: public.perfiles is required';
  end if;

  if to_regprocedure('public.es_admin()') is null then
    raise exception using
      errcode = 'P0001',
      message = '0027 preflight failed: public.es_admin() is required';
  end if;
end
$preflight$;

create table public.eventos_negocio (
  id bigint generated always as identity primary key,

  -- Lo esencial va tipado. El jsonb de abajo es para lo accesorio, no una
  -- excusa para no tipar.
  tipo text not null,

  -- SIN foreign key, a propósito. Una FK a auth.users rompería el borrado de
  -- cuentas: ON DELETE CASCADE se implementa como AFTER trigger sobre el
  -- padre, así que cuando el delete de perfiles corre, la fila de auth.users
  -- ya no es visible en el snapshot de esa transacción — un insert acá con FK
  -- fallaría con foreign_key_violation y abortaría el borrado completo.
  -- Sin FK, el uuid queda como pseudónimo desnormalizado: resoluble con un
  -- left join a perfiles mientras la cuenta viva, opaco después. Cero PII en
  -- esta tabla — el borrado real de la cuenta no debe poder deshacerse
  -- leyendo esta fila.
  usuario_ref uuid,

  ocurrido_en timestamptz not null default now(),
  -- Distinto de ocurrido_en para que un backfill pueda decir la verdad
  -- ("ocurrió en 2024, lo registré hoy") sin envenenar las series temporales.
  registrado_en timestamptz not null default now(),

  -- De dónde vino el registro ('trigger_perfiles', 'autoservicio',
  -- 'cascada_perfiles', 'backfill_0027'). Texto libre acotado a propósito:
  -- agregar un punto de instrumentación nuevo no debe requerir una migración.
  origen text not null default 'sistema',

  -- Payload flexible. Nunca PII: ni email, ni nombre, ni teléfono.
  datos jsonb not null default '{}'::jsonb,

  constraint eventos_negocio_tipo_valido
    check (tipo in ('alta_confirmada', 'baja_cuenta')),
  constraint eventos_negocio_usuario_en_ciclo_vida
    check (tipo not in ('alta_confirmada', 'baja_cuenta') or usuario_ref is not null),
  constraint eventos_negocio_origen_acotado
    check (char_length(origen) between 1 and 40),
  constraint eventos_negocio_datos_objeto
    check (jsonb_typeof(datos) = 'object'),
  constraint eventos_negocio_datos_acotado
    check (char_length(datos::text) <= 2048)
);

-- Un usuario tiene como mucho un alta y una baja registradas. El alta puede
-- llegar por el trigger de perfiles más de una vez si algo la reintenta, y la
-- baja se escribe por dos caminos (edge function + cascada) — este índice es
-- lo que hace seguro usar `on conflict do nothing` en ambos.
create unique index eventos_negocio_ciclo_vida_unico
  on public.eventos_negocio (tipo, usuario_ref)
  where tipo in ('alta_confirmada', 'baja_cuenta');

-- Consulta canónica: "altas/bajas por mes".
create index eventos_negocio_tipo_fecha_idx
  on public.eventos_negocio (tipo, ocurrido_en desc);

alter table public.eventos_negocio enable row level security;
alter table public.eventos_negocio force row level security;

revoke all on table public.eventos_negocio from public, anon, authenticated;

-- service_role: leer (reportes), insertar (delete-account) y borrar
-- (compensación si el borrado de la cuenta falla después de registrar el
-- evento). UPDATE nunca: un evento de negocio es inmutable.
grant select, insert, delete on table public.eventos_negocio to service_role;

-- Sólo admins leen esto desde el cliente. Es dato de negocio sensible (quién
-- se dio de alta, quién se fue), no debe ser legible por cualquier
-- authenticated.
grant select on table public.eventos_negocio to authenticated;

create policy eventos_negocio_select_admin
  on public.eventos_negocio for select
  to authenticated
  using ((select public.es_admin()));

-- Backfill ANTES de crear el trigger de alta (mismo orden que 0015):
-- reconstruye el histórico desde perfiles.creado_en, sin ventana en la que el
-- trigger pueda duplicar lo que el backfill ya cubrió.
insert into public.eventos_negocio (tipo, usuario_ref, ocurrido_en, origen, datos)
select 'alta_confirmada', p.id, p.creado_en, 'backfill_0027', jsonb_build_object('reconstruido', true)
from public.perfiles p
on conflict do nothing;

-- No se amplía handle_new_user() (0001/0003/0017): desde 0017 es un upsert
-- que no distingue "creé el perfil" de "rellené huecos de uno existente", así
-- que no hay forma barata de saber desde ahí si hubo un alta real. Un trigger
-- AFTER INSERT sobre perfiles sí distingue por construcción — y perfiles ya
-- ES la definición de alta desde 0003 (sólo entra ahí un usuario confirmado).
create or replace function public.registrar_alta_confirmada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- La analítica nunca debe poder bloquear un alta real: un AFTER trigger
  -- corre en la misma transacción que el INSERT que lo disparó, así que sin
  -- este bloque cualquier fallo no previsto acá (una constraint futura, un
  -- problema de permisos) abortaría la creación del perfil junto con él.
  -- on conflict do nothing ya cubre el caso esperado (duplicado); este
  -- bloque cubre todo lo demás, sin ocultar el problema — queda en el log.
  begin
    insert into public.eventos_negocio (tipo, usuario_ref, ocurrido_en, origen)
    values ('alta_confirmada', new.id, new.creado_en, 'trigger_perfiles')
    on conflict do nothing;
  exception
    when others then
      raise warning 'registrar_alta_confirmada failed for %: %', new.id, sqlerrm;
  end;
  return null;
end
$function$;

create trigger perfiles_registrar_alta
  after insert on public.perfiles
  for each row execute function public.registrar_alta_confirmada();

-- La garantía de la baja: atómico con la cascada de perfiles, cubre
-- cualquier camino de borrado (incluido el dashboard de Supabase), no sólo
-- delete-account. La edge function (fuera de esta migración) sólo agrega
-- contexto ANTES de que la cascada dispare esto; on conflict do nothing hace
-- que este trigger sea un no-op si esa escritura ya ganó.
create or replace function public.registrar_baja_cuenta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Mismo motivo que registrar_alta_confirmada(): un fallo no previsto acá
  -- no debe poder abortar el borrado real de una cuenta.
  begin
    insert into public.eventos_negocio (tipo, usuario_ref, origen)
    values ('baja_cuenta', old.id, 'cascada_perfiles')
    on conflict do nothing;
  exception
    when others then
      raise warning 'registrar_baja_cuenta failed for %: %', old.id, sqlerrm;
  end;
  return null;
end
$function$;

create trigger perfiles_registrar_baja
  after delete on public.perfiles
  for each row execute function public.registrar_baja_cuenta();

revoke all on function public.registrar_alta_confirmada() from public, anon, authenticated;
revoke all on function public.registrar_baja_cuenta() from public, anon, authenticated;

commit;

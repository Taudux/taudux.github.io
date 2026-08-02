-- Notificaciones push: paso 1 de N. Esta migración SOLO crea el almacén de
-- tokens Expo por usuario (`public.push_devices`); nada lee ni envía desde
-- acá todavía. La app taudux-mobile hará upsert de su propio token al
-- iniciar sesión / renovar el token; una migración posterior agregará el
-- worker de drenaje (service_role) que lea estos tokens en bulk y borre los
-- que Expo reporte como muertos.
--
-- Aplicar dos veces es seguro: `create table` sin `if not exists` fallaría
-- en un reintento real, pero la migración no hace ningún backfill con
-- estado mutable, así que no hay ventana de datos inconsistentes que
-- limpiar; un reintento tras un fallo a mitad de camino es un simple
-- re-run limpio sobre una base que nunca llegó a tener la tabla.

begin;

do $preflight$
begin
  if to_regclass('auth.users') is null then
    raise exception using
      errcode = 'P0001',
      message = '0021 preflight failed: auth.users is required';
  end if;

  if to_regclass('public.perfiles') is null then
    raise exception using
      errcode = 'P0001',
      message = '0021 preflight failed: public.perfiles is required';
  end if;
end
$preflight$;

create table public.push_devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null,
  platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, expo_push_token)
);

alter table public.push_devices enable row level security;
alter table public.push_devices force row level security;

revoke all on table public.push_devices from public, anon, authenticated;

grant select, insert, update, delete on table public.push_devices to authenticated;
grant select, insert, update, delete on table public.push_devices to service_role;

create policy push_devices_select_own
  on public.push_devices
  for select
  to authenticated
  using (user_id = auth.uid());

create policy push_devices_insert_own
  on public.push_devices
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy push_devices_update_own
  on public.push_devices
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy push_devices_delete_own
  on public.push_devices
  for delete
  to authenticated
  using (user_id = auth.uid());

commit;

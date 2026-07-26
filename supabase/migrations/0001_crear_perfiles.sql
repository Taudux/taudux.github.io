-- Tabla de perfiles: una fila por usuario de auth.users.
-- La fila se crea automáticamente al registrarse (trigger on_auth_user_created).
create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  apellidos text,
  telefono text,
  rol text not null default 'usuario',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- RLS: cada usuario solo puede ver y editar su propia fila.
alter table public.perfiles enable row level security;

create policy "perfiles_select_propio"
  on public.perfiles for select
  using (auth.uid() = id);

create policy "perfiles_update_propio"
  on public.perfiles for update
  using (auth.uid() = id);

-- El usuario puede editar solo estas columnas de su fila; nunca `rol`
-- (evita que alguien se auto-asigne 'admin'). Permiso a nivel de columna.
revoke update on public.perfiles from anon, authenticated;
grant update (nombre, apellidos, telefono) on public.perfiles to authenticated;

-- Función + trigger: al crear un usuario en auth.users, inserta su perfil
-- tomando nombre/apellidos del metadata del signUp.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.perfiles (id, nombre, apellidos)
  values (
    new.id,
    new.raw_user_meta_data ->> 'nombre',
    new.raw_user_meta_data ->> 'apellidos'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Mantiene actualizado_en al día en cada UPDATE.
create or replace function public.set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

create trigger perfiles_set_actualizado_en
  before update on public.perfiles
  for each row execute function public.set_actualizado_en();

-- Backfill: crea perfiles para los usuarios que ya existían antes de la tabla.
insert into public.perfiles (id, nombre, apellidos)
select id, raw_user_meta_data ->> 'nombre', raw_user_meta_data ->> 'apellidos'
from auth.users
on conflict (id) do nothing;

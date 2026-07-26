-- Tabla de cursos: catálogo publicado por administradores y visible para
-- cualquier usuario autenticado. Modelo link-only (sin Supabase Storage):
-- el curso vive en una URL externa; imagen_url es una miniatura opcional.
create table public.cursos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descripcion text,
  enlace text not null,
  imagen_url text,
  creado_por uuid references auth.users (id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  -- Defensa en BD: solo http/https; rechaza javascript:/data: aunque falle el cliente.
  constraint cursos_enlace_http check (enlace ~* '^https?://'),
  constraint cursos_imagen_http check (imagen_url is null or imagen_url ~* '^https?://')
);

-- Helper: ¿el usuario actual es administrador? Lee su propia fila de perfiles.
-- security definer + search_path vacío hace la comprobación robusta dentro de
-- las policies, sin depender de la RLS de perfiles.
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and rol = 'admin'
  );
$$;

-- RLS: leer para cualquier autenticado; crear/editar/borrar solo administradores.
alter table public.cursos enable row level security;

create policy "cursos_select_autenticados"
  on public.cursos for select
  using (auth.uid() is not null);

create policy "cursos_insert_admin"
  on public.cursos for insert
  with check (public.es_admin());

create policy "cursos_update_admin"
  on public.cursos for update
  using (public.es_admin());

create policy "cursos_delete_admin"
  on public.cursos for delete
  using (public.es_admin());

-- Mantiene actualizado_en al día en cada UPDATE (reutiliza la función de 0001).
create trigger cursos_set_actualizado_en
  before update on public.cursos
  for each row execute function public.set_actualizado_en();

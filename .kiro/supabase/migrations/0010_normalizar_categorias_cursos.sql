-- Normalizes course categories while keeping public.cursos.categoria during the
-- phase-one rollout. The compatibility triggers let old text clients and new ID
-- clients deploy in either order without creating category orphans.
-- Execute this complete file in one SQL Editor run. Any error rolls the transaction
-- back; fix the cause and rerun the complete file. Do not resume from the middle or
-- rerun after a successful COMMIT; this migration is intentionally not idempotent.

begin;

create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint categorias_nombre_normalizado
    check (
      nombre = btrim(nombre)
      and nombre !~ '^[[:space:]]|[[:space:]]$'
      and char_length(nombre) between 1 and 80
    )
);

create unique index categorias_nombre_unico
  on public.categorias (lower(nombre));

create trigger categorias_set_actualizado_en
  before update on public.categorias
  for each row execute function public.set_actualizado_en();

alter table public.cursos
  drop constraint if exists cursos_categoria_valida,
  add column categoria_id uuid,
  add constraint cursos_categoria_id_fkey
    foreign key (categoria_id)
    references public.categorias (id)
    on delete restrict;

-- Keep the two shipped options even on a database with no existing courses.
insert into public.categorias (nombre)
values
  ('Inteligencia artificial'),
  ('Análisis de datos')
on conflict (lower(nombre)) do nothing;

-- Also preserve every non-empty legacy value that may predate the old CHECK.
insert into public.categorias (nombre)
select min(btrim(categoria))
from public.cursos
where categoria is not null and btrim(categoria) <> ''
group by lower(btrim(categoria))
on conflict (lower(nombre)) do nothing;

update public.cursos as curso
set categoria_id = categoria.id,
    categoria = categoria.nombre
from public.categorias as categoria
where curso.categoria is not null
  and lower(btrim(curso.categoria)) = lower(categoria.nombre);

create or replace function public.sincronizar_categoria_curso()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  categoria_encontrada public.categorias%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.categoria_id is not null then
      select * into categoria_encontrada
      from public.categorias
      where id = new.categoria_id
      for share;
    elsif new.categoria is not null and btrim(new.categoria) <> '' then
      select * into categoria_encontrada
      from public.categorias
      where lower(nombre) = lower(btrim(new.categoria))
      for share;
    else
      new.categoria_id = null;
      new.categoria = null;
      return new;
    end if;
  elsif new.categoria_id is distinct from old.categoria_id then
    if new.categoria_id is null then
      new.categoria = null;
      return new;
    end if;

    select * into categoria_encontrada
    from public.categorias
    where id = new.categoria_id
    for share;
  elsif new.categoria is distinct from old.categoria then
    if new.categoria is null or btrim(new.categoria) = '' then
      new.categoria_id = null;
      new.categoria = null;
      return new;
    end if;

    select * into categoria_encontrada
    from public.categorias
    where lower(nombre) = lower(btrim(new.categoria))
    for share;
  else
    return new;
  end if;

  if categoria_encontrada.id is null then
    raise exception using
      errcode = '23503',
      message = 'La categoría del curso no existe.';
  end if;

  if not categoria_encontrada.activo then
    if tg_op = 'INSERT' then
      raise exception using
        errcode = '23514',
        message = 'La categoría está inactiva y no admite cursos nuevos.';
    elsif categoria_encontrada.id is distinct from old.categoria_id then
      raise exception using
        errcode = '23514',
        message = 'La categoría está inactiva y no admite cursos nuevos.';
    end if;
  end if;

  new.categoria_id = categoria_encontrada.id;
  new.categoria = categoria_encontrada.nombre;
  return new;
end;
$$;

create trigger cursos_sincronizar_categoria
  before insert or update of categoria_id, categoria on public.cursos
  for each row execute function public.sincronizar_categoria_curso();

create or replace function public.sincronizar_nombre_categoria_cursos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.nombre is distinct from old.nombre then
    update public.cursos
    set categoria = new.nombre
    where categoria_id = new.id;
  end if;
  return new;
end;
$$;

create trigger categorias_sincronizar_nombre_cursos
  after update of nombre on public.categorias
  for each row execute function public.sincronizar_nombre_categoria_cursos();

alter table public.categorias enable row level security;

create policy "categorias_select_publico"
  on public.categorias for select
  to anon, authenticated
  using (true);

create policy "categorias_insert_admin"
  on public.categorias for insert
  to authenticated
  with check ((select public.es_admin()));

create policy "categorias_update_admin"
  on public.categorias for update
  to authenticated
  using ((select public.es_admin()))
  with check ((select public.es_admin()));

create policy "categorias_delete_admin"
  on public.categorias for delete
  to authenticated
  using ((select public.es_admin()));

grant select on public.categorias to anon, authenticated;
grant insert, update, delete on public.categorias to authenticated;

commit;

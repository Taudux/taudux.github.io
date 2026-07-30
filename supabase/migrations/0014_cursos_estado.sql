-- Estado editorial del curso: borrador y archivado quedan ocultos al público;
-- solo un administrador los ve (catálogo o panel de administración). El
-- default 'publicado' preserva la visibilidad de las filas ya existentes al
-- aplicar esta migración; el cliente siempre manda un estado explícito en
-- creación/edición desde 0014 en adelante.
alter table public.cursos
  add column estado text not null default 'publicado'
    constraint cursos_estado_valido check (estado in ('borrador', 'publicado', 'archivado'));

-- La lectura pública deja de ser incondicional: un curso solo es visible sin
-- sesión (o para un autenticado no admin) cuando está publicado. es_admin()
-- ya existe desde 0004 y es security definer, así que la policy puede
-- invocarla sin depender de la RLS de perfiles.
drop policy "cursos_select_publico" on public.cursos;

create policy "cursos_select_publico"
  on public.cursos for select
  using (estado = 'publicado' or public.es_admin());

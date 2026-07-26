-- El catálogo de cursos pasa a ser público: se accede desde el navbar SIN iniciar
-- sesión, así que la lectura debe permitirse también al rol anónimo. La escritura
-- (insert/update/delete) sigue restringida a administradores por las policies de 0004.

-- Reemplaza la policy de solo-autenticados por una de lectura pública.
drop policy "cursos_select_autenticados" on public.cursos;

create policy "cursos_select_publico"
  on public.cursos for select
  using (true);

-- Asegura el grant de lectura al rol anónimo (authenticated ya lo tenía por defecto).
grant select on public.cursos to anon;

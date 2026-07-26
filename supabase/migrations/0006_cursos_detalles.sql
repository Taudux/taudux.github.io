-- Agrega detalles de horario/modalidad/instructor a public.cursos. Todas las
-- columnas son nullable: los cursos existentes (creados antes de esta migración)
-- siguen siendo válidos y las páginas ya renderizan cada dato solo si existe.
alter table public.cursos
  add column modalidad text,
  add column fecha date,
  add column hora_inicio time,
  add column duracion_minutos integer,
  add column instructor text;

alter table public.cursos
  add constraint cursos_modalidad_valida
    check (modalidad is null or modalidad in ('presencial', 'en_linea')),
  add constraint cursos_duracion_positiva
    check (duracion_minutos is null or duracion_minutos > 0);

-- RLS y triggers existentes (0004/0005) ya cubren estas columnas: heredan las
-- mismas policies por fila, no hay policy por columna en este proyecto.

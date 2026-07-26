-- Convierte cursos de "sesión única + link externo" (0004/0006) a "curso interno
-- recurrente": rango de fechas + días de la semana, con categoría/cupo/costo. Ver
-- decisions.md → ADR-005 (supersede el punto link-only de ADR-002).
alter table public.cursos
  drop constraint if exists cursos_enlace_http,
  drop column enlace,
  drop column fecha,
  drop column duracion_minutos;

-- modalidad, hora_inicio e instructor (de la 0006) se conservan tal cual.
alter table public.cursos
  add column categoria text,
  add column fecha_inicio date,
  add column fecha_fin date,
  add column dias_semana text[],
  add column duracion_horas numeric(4, 1),
  add column cupo_maximo integer,
  add column costo numeric(10, 2);

alter table public.cursos
  add constraint cursos_dias_validos
    check (
      dias_semana is null
      or dias_semana <@ array['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom']
    ),
  add constraint cursos_fechas_orden
    check (fecha_inicio is null or fecha_fin is null or fecha_fin >= fecha_inicio),
  add constraint cursos_duracion_positiva_horas
    check (duracion_horas is null or duracion_horas > 0),
  add constraint cursos_cupo_positivo
    check (cupo_maximo is null or cupo_maximo > 0),
  add constraint cursos_costo_no_negativo
    check (costo is null or costo >= 0);

-- categoria no lleva check: la lista fija la impone el <select> del cliente, así
-- ampliarla más adelante no exige otra migración.

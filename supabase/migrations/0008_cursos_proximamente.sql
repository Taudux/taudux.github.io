-- Flag para anunciar un curso sin horario definitivo todavía: si es true, el
-- catálogo público muestra un badge "Próximamente" en vez de fecha/hora/días.
-- El curso sigue siendo visible (no es un toggle de publicado/borrador).
alter table public.cursos
  add column proximamente boolean not null default false;

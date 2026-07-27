-- La lista de categorías válidas pasa a vivir también en la BD (antes solo la
-- imponía el <select> del cliente, ver ADR-005). Agregar una categoría nueva
-- requiere una migración que amplíe esta lista + el <option> correspondiente
-- en la ruta actual de administración y catálogo de cursos.
alter table public.cursos
  add constraint cursos_categoria_valida
    check (
      categoria is null
      or categoria in ('Inteligencia artificial', 'Análisis de datos')
    );

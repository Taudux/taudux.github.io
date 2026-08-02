-- Contenido editable de un curso: el temario y los cuatro campos de contexto que
-- la pantalla pública de detalle (detalle-curso.html) ya sabe mostrar.
--
-- Hasta ahora el temario vivía hardcodeado en una constante de JavaScript
-- (TEMARIOS_EXTRA en src/app/features/courses/curso-detalle.js), con el uuid del
-- curso como clave: un curso nuevo nunca podía tener temario y editar el
-- existente exigía tocar código y desplegar. Esta migración lo mueve a la base
-- para que se cargue desde el panel de administración, para cualquier curso.
--
-- Por qué jsonb y no tablas hijas (curso_modulos / curso_temas): guardar un curso
-- es un solo UPDATE desde el navegador (construirActualizacionCurso en
-- cursos.service.js). No hay RPC de escritura ni transacción del lado del cliente
-- en este proyecto, así que con tablas hijas el guardado serían cuatro viajes sin
-- rollback (update curso, delete módulos, insert módulos, insert temas) y un
-- fallo intermedio dejaría el temario a medias en producción. Con una columna el
-- guardado sigue siendo atómico sin infraestructura nueva.
--
-- Forma de temario: un arreglo de módulos en orden de dictado.
--   [{ "titulo": "…", "subtitulo": "…", "temas": ["…", "…"] }]
-- El CHECK solo garantiza el contenedor. La forma interna la valida el cliente
-- (gestionar-curso.temario.js), igual que categoria no lleva check porque la
-- lista la impone el <select> (ver el cierre de 0007).
--
-- RLS no se toca: las policies de 0004/0014 son por fila y ya cubren columnas
-- nuevas. Este proyecto no usa policies por columna (ver 0006).
--
-- Verify the target project is yqkvgfqplmbbcebrivpt before running this file.
--
-- Applying this migration twice is safe: todas las cláusulas usan IF NOT EXISTS
-- y el preflight valida los prerequisitos antes de tocar nada.

begin;

do $preflight$
begin
  if to_regclass('public.cursos') is null then
    raise exception using
      errcode = 'P0001',
      message = '0020 preflight failed: table public.cursos is required';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cursos'
      and column_name = 'proximamente'
  ) then
    raise exception using
      errcode = 'P0001',
      message = '0020 preflight failed: migration 0008 must be applied first';
  end if;
end
$preflight$;

alter table public.cursos
  add column if not exists temario jsonb,
  add column if not exists dirigido_a text,
  add column if not exists requisitos text,
  add column if not exists herramientas text,
  add column if not exists numero_sesiones integer;

-- Null-tolerante como el resto del esquema: un curso sin estos datos sigue
-- siendo válido y la pantalla de detalle simplemente oculta esas secciones.
alter table public.cursos
  drop constraint if exists cursos_temario_es_arreglo,
  drop constraint if exists cursos_numero_sesiones_positivo;

alter table public.cursos
  add constraint cursos_temario_es_arreglo
    check (temario is null or jsonb_typeof(temario) = 'array'),
  add constraint cursos_numero_sesiones_positivo
    check (numero_sesiones is null or numero_sesiones > 0);

commit;

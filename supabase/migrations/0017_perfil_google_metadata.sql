-- Los usuarios de Google llegan con metadata de OIDC (given_name/family_name/
-- full_name/name), no con las claves del signup propio (nombre/apellidos/
-- telefono). Sin esto el perfil queda con nombre y apellidos en NULL.
--
-- El insert pasa de `do nothing` a un upsert que solo RELLENA huecos: nunca
-- pisa un dato que el usuario ya editó en el portal. Hace falta porque el
-- trigger puede volver a correr (update de email_confirmed_at) sobre una
-- cuenta que ya tenía fila, y con `do nothing` esa fila nunca se completaría.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nombre_completo text := nullif(trim(coalesce(meta ->> 'full_name', meta ->> 'name')), '');
  nombre_final text;
  apellidos_final text;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  nombre_final := coalesce(
    nullif(trim(meta ->> 'nombre'), ''),
    nullif(trim(meta ->> 'given_name'), ''),
    nullif(trim(split_part(nombre_completo, ' ', 1)), '')
  );

  -- El apellido desde full_name toma todo lo que sigue al primer token: en
  -- español el apellido suele ser compuesto y split_part(2) perdería el
  -- segundo apellido.
  apellidos_final := coalesce(
    nullif(trim(meta ->> 'apellidos'), ''),
    nullif(trim(meta ->> 'family_name'), ''),
    nullif(trim(substr(nombre_completo, length(split_part(nombre_completo, ' ', 1)) + 1)), '')
  );

  insert into public.perfiles (id, nombre, apellidos, telefono)
  values (
    new.id,
    nombre_final,
    apellidos_final,
    nullif(trim(meta ->> 'telefono'), '')
  )
  on conflict (id) do update
    set nombre    = coalesce(public.perfiles.nombre, excluded.nombre),
        apellidos = coalesce(public.perfiles.apellidos, excluded.apellidos),
        telefono  = coalesce(public.perfiles.telefono, excluded.telefono)
    where public.perfiles.nombre is null
       or public.perfiles.apellidos is null
       or public.perfiles.telefono is null;

  return new;
end;
$$;

-- Backfill: completa los perfiles ya creados que quedaron sin nombre
-- (p. ej. porque el usuario original vino de un provider sin datos, o de un
-- alta previa a este cambio).
update public.perfiles p
set nombre = coalesce(
      p.nombre,
      nullif(trim(u.raw_user_meta_data ->> 'given_name'), ''),
      nullif(trim(split_part(coalesce(u.raw_user_meta_data ->> 'full_name',
                                      u.raw_user_meta_data ->> 'name', ''), ' ', 1)), '')
    ),
    apellidos = coalesce(
      p.apellidos,
      nullif(trim(u.raw_user_meta_data ->> 'family_name'), '')
    )
from auth.users u
where p.id = u.id
  and (p.nombre is null or p.apellidos is null);

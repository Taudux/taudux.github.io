-- Actualiza el trigger de alta de usuario para que también guarde el teléfono
-- capturado en el registro (antes solo insertaba nombre/apellidos).
-- El trigger on_auth_user_created no se toca: sigue apuntando a esta función por nombre.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.perfiles (id, nombre, apellidos, telefono)
  values (
    new.id,
    new.raw_user_meta_data ->> 'nombre',
    new.raw_user_meta_data ->> 'apellidos',
    new.raw_user_meta_data ->> 'telefono'
  );
  return new;
end;
$$;

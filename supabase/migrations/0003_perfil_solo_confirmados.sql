-- Crea el perfil SOLO cuando el correo está confirmado, para no llenar
-- perfiles con cuentas que nunca verifican.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null then
    insert into public.perfiles (id, nombre, apellidos, telefono)
    values (
      new.id,
      new.raw_user_meta_data ->> 'nombre',
      new.raw_user_meta_data ->> 'apellidos',
      new.raw_user_meta_data ->> 'telefono'
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

-- Reemplaza el trigger: ahora escucha el alta Y la confirmación
-- (UPDATE de email_confirmed_at, que es cuando el usuario valida el correo).
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.handle_new_user();

-- Limpieza: elimina de perfiles las filas de usuarios que aún no confirman.
delete from public.perfiles p
using auth.users u
where p.id = u.id and u.email_confirmed_at is null;

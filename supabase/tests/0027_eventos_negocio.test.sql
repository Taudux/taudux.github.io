\set ON_ERROR_STOP on

-- Destructive by design: run only in the isolated database named below.
do $guard$
begin
  if current_database() <> 'taudux_eventos_negocio_0027_test' then
    raise exception 'Refusing to run outside taudux_eventos_negocio_0027_test';
  end if;
end
$guard$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$roles$;

create schema auth;
create table auth.users (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  deleted_at timestamptz
);

-- Minimal stand-in for Supabase's real auth.uid(): reads the same GUC
-- (request.jwt.claim.sub) PostgREST sets per request, so policies written
-- against auth.uid() exercise the real RLS path under `set role`.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  rol text not null default 'usuario',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Real es_admin(), mismo shape que 0004: el preflight de 0027 lo exige, y la
-- policy de lectura admin de eventos_negocio lo invoca de verdad.
create function public.es_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and rol = 'admin'
  );
$$;

-- Sembrado ANTES del \ir a propósito: ejercita el backfill de la migración,
-- no sólo el trigger que corre después.
insert into auth.users (id, email, email_confirmed_at) values
  ('40000000-0000-4000-8000-000000000001', 'usuario1@example.com', now()),
  ('40000000-0000-4000-8000-000000000002', 'usuario2@example.com', now()),
  ('40000000-0000-4000-8000-000000000003', 'admin@example.com', now());
insert into public.perfiles (id, nombre, rol, creado_en) values
  ('40000000-0000-4000-8000-000000000001', 'Uno', 'usuario', '2026-01-01T00:00:00Z'),
  ('40000000-0000-4000-8000-000000000002', 'Dos', 'usuario', '2026-01-02T00:00:00Z'),
  ('40000000-0000-4000-8000-000000000003', 'Admin', 'admin', '2026-01-03T00:00:00Z');

\ir ../migrations/0027_eventos_negocio.sql

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $assert$
begin
  if condition is distinct from true then
    raise exception 'assertion failed: %', message;
  end if;
end
$assert$;

-- 1. Backfill: los 3 perfiles sembrados antes del \ir generaron su
-- alta_confirmada, con ocurrido_en = perfiles.creado_en (no now()).
select pg_temp.assert_true(
  (select count(*) = 3 from public.eventos_negocio
   where tipo = 'alta_confirmada' and origen = 'backfill_0027'),
  'el backfill genera exactamente 3 altas'
);
select pg_temp.assert_true(
  (select ocurrido_en = '2026-01-01T00:00:00Z'::timestamptz
   from public.eventos_negocio
   where tipo = 'alta_confirmada'
     and usuario_ref = '40000000-0000-4000-8000-000000000001'),
  'el backfill preserva creado_en como ocurrido_en, no now()'
);

-- 2. Forma: constraints rechazan lo inválido.
do $bad_tipo$
begin
  begin
    insert into public.eventos_negocio (tipo) values ('otra_cosa');
    raise exception 'un tipo fuera del check debió fallar';
  exception
    when check_violation then null;
  end;
end
$bad_tipo$;

do $bad_datos$
begin
  begin
    insert into public.eventos_negocio (tipo, usuario_ref, datos)
    values ('alta_confirmada', '40000000-0000-4000-8000-000000000001', '[]'::jsonb);
    raise exception 'datos no-objeto debió fallar';
  exception
    when check_violation then null;
  end;
end
$bad_datos$;

do $bad_usuario_ref$
begin
  begin
    insert into public.eventos_negocio (tipo, usuario_ref) values ('baja_cuenta', null);
    raise exception 'baja_cuenta sin usuario_ref debió fallar';
  exception
    when check_violation then null;
  end;
end
$bad_usuario_ref$;

-- Límites de origen (1-40 caracteres) y datos (<=2048 como texto): un
-- off-by-one acá (< vs <=, 40 vs 41) pasaría desapercibido sin estos casos.
do $origen_vacio$
begin
  begin
    insert into public.eventos_negocio (tipo, usuario_ref, origen)
    values ('alta_confirmada', '40000000-0000-4000-8000-000000000099', '');
    raise exception 'origen vacío debió fallar';
  exception
    when check_violation then null;
  end;
end
$origen_vacio$;

do $origen_muy_largo$
begin
  begin
    insert into public.eventos_negocio (tipo, usuario_ref, origen)
    values ('alta_confirmada', '40000000-0000-4000-8000-000000000099', repeat('a', 41));
    raise exception 'origen de 41 caracteres debió fallar';
  exception
    when check_violation then null;
  end;
end
$origen_muy_largo$;

insert into public.eventos_negocio (tipo, usuario_ref, origen)
values ('alta_confirmada', '40000000-0000-4000-8000-000000000099', repeat('a', 40));
select pg_temp.assert_true(
  exists (
    select 1 from public.eventos_negocio
    where usuario_ref = '40000000-0000-4000-8000-000000000099' and char_length(origen) = 40
  ),
  'origen de exactamente 40 caracteres es válido (el límite es inclusivo)'
);
-- Limpieza: esta fila es sólo del caso límite, no debe contarse en las
-- aserciones de conteo/lectura que siguen más abajo.
delete from public.eventos_negocio where usuario_ref = '40000000-0000-4000-8000-000000000099';

do $datos_muy_largo$
begin
  begin
    insert into public.eventos_negocio (tipo, usuario_ref, datos)
    values (
      'baja_cuenta',
      '40000000-0000-4000-8000-000000000099',
      jsonb_build_object('relleno', repeat('a', 2100))
    );
    raise exception 'datos que exceden 2048 caracteres como texto debió fallar';
  exception
    when check_violation then null;
  end;
end
$datos_muy_largo$;

-- 3. RLS habilitada y forzada.
select pg_temp.assert_true(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.eventos_negocio'::regclass),
  'eventos_negocio tiene RLS habilitada y forzada'
);

-- 4. Privilegios por rol: anon nada; authenticated sólo select;
-- service_role select/insert/delete, nunca update.
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.eventos_negocio', 'select')
    and not has_table_privilege('anon', 'public.eventos_negocio', 'insert'),
  'anon no tiene ningún privilegio sobre eventos_negocio'
);
select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.eventos_negocio', 'select')
    and not has_table_privilege('authenticated', 'public.eventos_negocio', 'insert')
    and not has_table_privilege('authenticated', 'public.eventos_negocio', 'update')
    and not has_table_privilege('authenticated', 'public.eventos_negocio', 'delete'),
  'authenticated sólo puede leer, nunca escribir eventos_negocio'
);
select pg_temp.assert_true(
  has_table_privilege('service_role', 'public.eventos_negocio', 'select')
    and has_table_privilege('service_role', 'public.eventos_negocio', 'insert')
    and has_table_privilege('service_role', 'public.eventos_negocio', 'delete')
    and not has_table_privilege('service_role', 'public.eventos_negocio', 'update'),
  'service_role puede leer/insertar/borrar, nunca actualizar (evento inmutable)'
);

-- 5. Lectura: un usuario normal no ve nada; un admin ve todo.
set role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', false);
select pg_temp.assert_true(
  (select count(*) = 0 from public.eventos_negocio),
  'un usuario normal no ve ninguna fila de eventos_negocio'
);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000003', false);
select pg_temp.assert_true(
  (select count(*) = 3 from public.eventos_negocio),
  'un admin ve todas las filas de eventos_negocio'
);
reset role;

-- 6. Alta automática: un cuarto usuario dispara el trigger perfiles_registrar_alta.
insert into auth.users (id, email, email_confirmed_at) values
  ('40000000-0000-4000-8000-000000000004', 'usuario4@example.com', now());
insert into public.perfiles (id, nombre, rol) values
  ('40000000-0000-4000-8000-000000000004', 'Cuatro', 'usuario');
select pg_temp.assert_true(
  (select count(*) = 1 from public.eventos_negocio
   where tipo = 'alta_confirmada'
     and usuario_ref = '40000000-0000-4000-8000-000000000004'
     and origen = 'trigger_perfiles'),
  'insertar un perfil nuevo dispara una alta_confirmada vía trigger_perfiles'
);

-- 7. Idempotencia: una segunda alta manual para el mismo usuario viola el
-- índice único parcial.
do $dup_alta$
begin
  begin
    insert into public.eventos_negocio (tipo, usuario_ref, origen)
    values ('alta_confirmada', '40000000-0000-4000-8000-000000000004', 'manual');
    raise exception 'una segunda alta_confirmada para el mismo usuario debió fallar';
  exception
    when unique_violation then null;
  end;
end
$dup_alta$;

-- 8. La aserción central: borrar de verdad una cuenta no falla, y deja un
-- rastro con el usuario_ref intacto. Es la única razón de ser de la tabla.
delete from auth.users where id = '40000000-0000-4000-8000-000000000002';
select pg_temp.assert_true(
  not exists (select 1 from public.perfiles where id = '40000000-0000-4000-8000-000000000002'),
  'el perfil desaparece con la cuenta (cascada normal, sin cambios)'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.eventos_negocio
   where tipo = 'baja_cuenta'
     and usuario_ref = '40000000-0000-4000-8000-000000000002'
     and origen = 'cascada_perfiles'),
  'borrar la cuenta deja una baja_cuenta con usuario_ref intacto, vía cascada_perfiles'
);

-- 9. Los dos caminos de la baja no se pisan: si "delete-account" ya escribió
-- el evento (origen='autoservicio'), la cascada no lo duplica ni lo pisa.
insert into auth.users (id, email, email_confirmed_at) values
  ('40000000-0000-4000-8000-000000000005', 'usuario5@example.com', now());
insert into public.perfiles (id, nombre, rol) values
  ('40000000-0000-4000-8000-000000000005', 'Cinco', 'usuario');
insert into public.eventos_negocio (tipo, usuario_ref, origen, datos)
values ('baja_cuenta', '40000000-0000-4000-8000-000000000005', 'autoservicio', jsonb_build_object('via', 'autoservicio'));
delete from auth.users where id = '40000000-0000-4000-8000-000000000005';
select pg_temp.assert_true(
  (select count(*) = 1 from public.eventos_negocio
   where tipo = 'baja_cuenta' and usuario_ref = '40000000-0000-4000-8000-000000000005'),
  'la baja escrita por delete-account y la de la cascada no se duplican'
);
select pg_temp.assert_true(
  (select origen = 'autoservicio' from public.eventos_negocio
   where tipo = 'baja_cuenta' and usuario_ref = '40000000-0000-4000-8000-000000000005'),
  'cuando delete-account ya escribió el evento, la cascada no lo pisa'
);

-- 10. Sin foreign key: la falta de FK es una decisión de diseño, no un
-- descuido — este assert la fija como contrato para que nadie la "arregle".
select pg_temp.assert_true(
  not exists (
    select 1 from pg_constraint
    where conrelid = 'public.eventos_negocio'::regclass and contype = 'f'
  ),
  'eventos_negocio no tiene ninguna foreign key (a propósito, ver comentario de la migración)'
);

-- 11. La analítica nunca debe poder bloquear el alta/baja real: se fuerza un
-- fallo REAL dentro de los triggers (la tabla que intentan escribir ya no
-- existe, así que el insert interno falla con undefined_table, no con el
-- conflicto ya cubierto por on conflict do nothing) y se confirma que el
-- alta y la baja de todos modos se completan. Va al final porque destruye
-- la tabla a propósito; no hay limpieza que hacer después.
drop table public.eventos_negocio;

insert into auth.users (id, email, email_confirmed_at) values
  ('40000000-0000-4000-8000-000000000006', 'usuario6@example.com', now());
insert into public.perfiles (id, nombre, rol) values
  ('40000000-0000-4000-8000-000000000006', 'Seis', 'usuario');
select pg_temp.assert_true(
  exists (select 1 from public.perfiles where id = '40000000-0000-4000-8000-000000000006'),
  'un fallo real dentro del trigger de alta (tabla inexistente) no aborta el insert de perfiles'
);

delete from auth.users where id = '40000000-0000-4000-8000-000000000006';
select pg_temp.assert_true(
  not exists (select 1 from public.perfiles where id = '40000000-0000-4000-8000-000000000006'),
  'un fallo real dentro del trigger de baja (tabla inexistente) no aborta el delete de perfiles'
);

select '0027 eventos de negocio: PASS' as result;

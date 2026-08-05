-- push_devices pasa a identificar DISPOSITIVOS en vez de tokens.
--
-- 0021 creó la tabla con primary key (user_id, expo_push_token). Eso hacía que
-- cada token fuera una fila independiente, y FCM rota los tokens: cada
-- rotación agregaba una fila más y nada borraba la anterior mientras siguiera
-- viva. Observado en producción el 2026-08-05: tres filas del mismo teléfono
-- (registradas 00:23 y 01:45 del 04-ago y 06:14 del 05-ago), o sea tres
-- notificaciones por cada anuncio.
--
-- El arreglo es mover la identidad al dispositivo: la app genera un UUID la
-- primera vez que corre, lo persiste en expo-secure-store, y lo manda como
-- installation_id. El token pasa a ser un atributo mutable de esa fila, así
-- que una rotación ACTUALIZA en vez de acumular.
--
-- POR QUÉ SE BORRAN LAS FILAS EXISTENTES (decisión, no descuido): las filas
-- creadas bajo el esquema viejo no tienen installation_id y no hay manera de
-- inventarles uno correcto. Generarles un UUID al azar sería peor que
-- borrarlas: la app registraría el suyo propio al arrancar y la fila
-- inventada quedaría huérfana para siempre, reproduciendo exactamente el
-- problema que esta migración cierra. El costo real es una ventana en la que
-- esos dispositivos no reciben push hasta volver a abrir la app.
--
-- ORDEN DE DESPLIEGUE: aplicar esto ANTES de instalar la app nueva. La app
-- vieja no puede registrar tokens después de esta migración -- su upsert usa
-- `on conflict (user_id, expo_push_token)`, un constraint que deja de existir.
--
-- Aplicar dos veces es seguro: los add column / drop constraint son
-- condicionales y el swap de primary key descubre el nombre real de la
-- constraint vigente en vez de asumirlo.

begin;

do $preflight$
begin
  if to_regclass('public.push_devices') is null then
    raise exception using
      errcode = 'P0001',
      message = '0025 preflight failed: public.push_devices is required (apply 0021 first)';
  end if;
end
$preflight$;

-- 1. Vaciar la tabla antes de agregar la columna not null. Sin esto, un
--    `add column ... not null` sin default fallaría con filas presentes.
delete from public.push_devices;

alter table public.push_devices
  add column if not exists installation_id uuid not null;

-- 2. Swap de primary key: (user_id, expo_push_token) -> (user_id, installation_id).
--    0021 la creó con `primary key (...)` inline, sin nombre explícito, así que
--    se descubre el nombre real en vez de asumir la convención.
do $swap_pk$
declare
  pk_name text;
begin
  select conname
  into pk_name
  from pg_constraint
  where conrelid = 'public.push_devices'::regclass
    and contype = 'p';

  if pk_name is null then
    raise exception using
      errcode = 'P0001',
      message = '0025 failed: public.push_devices has no primary key to replace';
  end if;

  execute format('alter table public.push_devices drop constraint %I', pk_name);
end
$swap_pk$;

alter table public.push_devices
  add constraint push_devices_pkey primary key (user_id, installation_id);

-- 3. El token deja de ser identidad pero sigue siendo obligatorio: una fila sin
--    token no sirve para nada, no hay a dónde mandar.
--
--    No se le pone unique: el mismo token PUEDE aparecer en dos filas si dos
--    usuarios comparten el teléfono, y en ese caso el aparato debe recibir una
--    notificación por cada cuenta suscripta. Forzar unicidad rompería ese caso
--    silenciosamente, quitándole las notificaciones a uno de los dos.
alter table public.push_devices
  alter column expo_push_token set not null;

-- 4. RLS, políticas y grants de 0021 no se tocan: siguen expresados sobre
--    user_id, que no cambió. Un cambio de primary key no afecta row level
--    security.

commit;

# taudux.com

Plataforma de cursos. Sitio estático (HTML/CSS/JS vanilla) desplegado en
**Vercel**, con **Supabase** como backend. Idioma del producto: español.

La app móvil vive en un repo aparte: `taudux-mobile`.

## `src/` es la raíz web

`vercel.json` define `outputDirectory: "src"`, así que **`/src/` nunca va en una
URL**. Los links internos se escriben sin ese prefijo:

```html
<!-- archivo real: src/app/core/cursos/cursos.service.js -->
<script src="/app/core/cursos/cursos.service.js"></script>
```

Existen redirects **301** desde `/src/:path*`, pero son para links viejos que
quedaron indexados — no una forma válida de escribir rutas nuevas. Un 301 lo
cachea el navegador indefinidamente. `cleanUrls: true` además sirve las páginas
sin la extensión `.html`.

## Estructura

| Ruta | Qué hay |
|---|---|
| `src/app/core/` | Capa de datos y servicios, un directorio por dominio (`auth`, `cursos`, `perfil`, `categorias`, `supabase`, `telemetry`). Sufijo `.service.js`. |
| `src/app/features/` | Una carpeta por área de la app (`auth`, `courses`, `portal`, `legal`, `home`, `detector`). |
| `src/app/shared/` | Primitivas de presentación (`button`, `toast`, `confirm-dialog`, `navbar`, `panel`, `field`…). |
| `supabase/migrations/` | 26 migraciones SQL, numeración contigua desde `0001`. |
| `supabase/functions/` | Edge functions Deno, más `_shared/` reutilizable entre ellas. |
| `supabase/tests/` | 11 tests SQL contra bases desechables. |
| `tests/` | 23 tests JS con el runner integrado de Node. |

### Tres decisiones que no se adivinan

**1. El browser no tiene sistema de módulos.** El JS bajo `src/` no usa
`export`: las páginas lo cargan con `<script src="...">` planos y todo vive en
globales. Por eso los módulos co-locados se nombran con punto —
`gestionar-curso.portada.js`, `portal.correo.js`— en vez de subcarpetas: son
scripts hermanos de una misma página. Consecuencia importante: **el orden de los
`<script>` en el HTML es una dependencia real**. Por ejemplo,
`supabase-client.js` debe cargar antes que `auth.service.js` y `navbar.js`.

**2. `.mjs` conviviendo con `.ts` en las edge functions es a propósito.** La
lógica pura va en `.mjs` para que el runner de Node pueda importarla y testearla
directo (`tests/anuncios-curso.test.js` importa `anuncios.mjs`); el pegamento
específico de Deno queda en `index.ts`.

**3. No hay `package.json`, bundler, linter ni paso de build.** Es deliberado, no
una tarea pendiente. Las dependencias del browser llegan por CDN.

## Tests

**JavaScript** — desde la raíz del repo:

```bash
node --test "tests/*.test.js"
```

El glob **entre comillas** importa: la forma `node --test tests/` falla en Git
Bash (interpreta `tests/` como un módulo). Y hay que correrlo desde la raíz
porque varios tests leen rutas relativas.

**SQL** — contra una base desechable con Postgres local:

```bash
psql "postgresql://postgres@127.0.0.1:5432/<nombre_exacto>" \
  -v ON_ERROR_STOP=1 -f supabase/tests/00XX_nombre.test.sql
```

Cada script declara el nombre de base que exige y **se niega a correr en
cualquier otra** — son destructivos por diseño.

> **Nada de esto corre en CI.** No hay ningún workflow que ejecute tests: si
> algo se rompe, sólo lo detecta quien corra los comandos a mano.

## Qué dispara qué

| Mecanismo | Qué hace | Cadencia |
|---|---|---|
| **pg_cron** (migración `0019`) | Drena la cola de anuncios de curso | Automático, cada 5 min |
| **GitHub Actions** | Drenado manual, verificar despliegues | **Sólo a mano** |
| **Vercel** | Deploy del sitio | Automático al hacer push |
| **Migraciones y edge functions** | — | **Siempre manual** |

El único disparo automático del drenado es `pg_cron`, **dentro de la base**. El
workflow de GitHub Actions existe sólo como herramienta manual: su `schedule` se
quitó el 2026-08-06 porque GitHub mostró dos modos de falla distintos (saltearse
~7 de cada 8 corridas programadas, y no conseguir runner tras ~15 minutos de
reintentos). Ninguna de esas fallas afectaba los envíos —`pg_cron` ya los
cubría— pero cada una se veía idéntica a una caída de producción.

## Advertencias operativas

- **No corras `supabase db push`.** Las migraciones se aplican **a mano**, una
  por una, como transacción completa en el SQL Editor de Supabase.
- **El orden importa más que la numeración.** Aplicarlas fuera de orden rompe el
  registro de dispositivos de la app móvil, y la `0025` vacía `push_devices`
  incondicionalmente.
- **Las edge functions se despliegan a mano** (`supabase functions deploy`).
  Ningún CI lo hace: un commit pusheado **no** actualiza la función en
  producción.
- **La URL y la anon key de Supabase están hardcodeadas a propósito** en
  `src/app/core/supabase/supabase-client.js`: son públicas por diseño y la
  seguridad la da RLS. El `service_role` key nunca toca el frontend — vive sólo
  en los secrets de las edge functions.
- Las sesiones usan `sessionStorage`, no `localStorage`: viven por pestaña y
  terminan al cerrarla.

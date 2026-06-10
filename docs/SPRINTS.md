# SPRINTS.md — Plan operativo S5–S8

Plan de los próximos sprints. Continúa el roadmap de `docs/PLAN.md`
(S1–S4 completados; el detalle de S4/marine está en `docs/SPRINTS_PLAN.md`).

| Sprint | Tema | Objetivo |
|--------|------|----------|
| S5 | Estaciones por ciudad (Meteoclimatic) | Las estaciones del tab "Estaciones" se obtienen automáticamente para la ciudad que el usuario está consultando, incluyendo Meteoclimatic |
| S6 | Refresco desde móvil | En móvil se puede forzar el refresco de la última búsqueda de modelos, no solo ver la antigüedad de la descarga |
| S7 | Mejoras estéticas | Pulido visual en mobile y desktop; mobile horizontal se comporta como desktop |
| S8 | Corrección de errores | Resolver el catálogo de bugs de la auditoría de 2026-06-10 (3 altos, 13 medios, 13 bajos) |

---

## Sprint 5 — Estaciones meteorológicas conectadas a la ciudad buscada

### Contexto y problema

Hoy `components/StationDashboard.tsx` es una isla desconectada de la
búsqueda principal:

- Las regiones están **hardcodeadas** en `REGIONS`
  (`lib/meteoclimatic-types.ts:46-55`): solo Catalunya, Madrid y València.
- Meteoclimatic se consulta con un mapa estático `METEOCLIMATIC_MAP`
  (`StationDashboard.tsx:44-47`) y además es **opt-in** vía checkbox.
- La ciudad seleccionada en `CitySearch` / mapa (`position` en
  `app/home-content.tsx`) **no se propaga** al dashboard de estaciones
  (`home-content.tsx:722` renderiza `<StationDashboard />` sin props).

Lo que ya funciona a favor: los feeds RSS de Meteoclimatic son
**jerárquicos por prefijo** (`https://meteoclimatic.net/feed/rss/{prefijo}`,
p. ej. `ESCAT08` devuelve todas las estaciones de la provincia de
Barcelona) y `lib/meteoclimatic.ts` ya sabe parsearlos
(`parseRss`, `fetchStationData`).

### Diseño

1. **Resolver coordenadas → prefijo Meteoclimatic.** Los códigos de
   estación siguen el patrón `ES` + trigrama de CCAA + código INE de
   provincia (`ESCAT08`, `ESMAD28`, `ESPVA46`…). Se crea una tabla
   estática con las ~52 provincias españolas (prefijo, bounding box,
   centroide) y una función `resolveMeteoclimaticPrefix(lat, lon)`
   (point-in-bbox con fallback a centroide más cercano). Fuera de España
   (Meteoclimatic cubre sobre todo ES/PT/FR) se devuelve `null` y la UI
   muestra un empty state.
2. **Filtrado por proximidad, no por región fija.** Con el feed de la
   provincia descargado, se filtran estaciones a un radio configurable
   (por defecto 30 km, haversine) alrededor de la ciudad buscada y se
   ordenan por distancia. AEMET (`/api/aemet` ya devuelve todas las
   estaciones de España) se filtra con el mismo criterio, eliminando la
   dependencia de los bboxes de `REGIONS`.
3. **Propagar la ciudad al dashboard.** `home-content.tsx` pasa
   `position` y el nombre de la ubicación a `StationDashboard`. Al
   cambiar la ciudad (búsqueda, clic en mapa, ubicación guardada) el tab
   de estaciones se actualiza solo. El selector de región pasa a ser un
   override manual opcional («Cerca de {ciudad}» como opción por defecto).
4. **Meteoclimatic activado por defecto** cuando hay prefijo resuelto;
   el checkbox se mantiene para poder excluirlo.

### Especificación de implementación

> Esta sección es el manual para quien implemente el sprint. Toda la
> infraestructura de fetch/parseo de Meteoclimatic **ya existe** en
> `lib/meteoclimatic.ts`; el trabajo es de resolución geográfica y
> cableado, no de parsing.

#### A. El feed de Meteoclimatic (lo ya conocido y validado)

- URL: `https://meteoclimatic.net/feed/rss/{código}` donde `{código}`
  puede ser una estación concreta **o cualquier prefijo jerárquico**:
  `ES` ⊃ `ESCAT` ⊃ `ESCAT08` ⊃ `ESCAT0800000008181C`. Un prefijo
  devuelve un `<item>` por cada estación que cuelga de él. El código
  actual ya explota esto (`METEOCLIMATIC_MAP` usa `ESCAT08`, `ESCAT`…).
- Cabeceras necesarias (sin ellas el servidor rechaza; ya están en
  `fetchStationData`, `lib/meteoclimatic.ts:103-110`): `User-Agent` de
  navegador, `Accept: application/xml+rss,...`, `Referer:
  https://www.meteoclimatic.net/`. Timeout 15 s con `AbortSignal`.
- Formato de cada `<item>` (lo que espera `parseItem`,
  `lib/meteoclimatic.ts:22-85`):

  ```xml
  <item>
    <title>Nombre de la estación</title>
    <pubDate>Mon, 09 Jun 2026 18:40:00 +0200</pubDate>
    <georss:point>41.39 2.16</georss:point>   <!-- lat lon, en ese orden -->
    <description>... [[<CÓDIGO;(temp;tmax;tmin;condición);(hum;hmax;hmin);(pres;pmax;pmin);(viento;racha;rumbo);(precip);NOMBRE>]] ...</description>
  </item>
  ```

  Los números usan coma decimal (`parseCommaFloat` ya normaliza) y los
  campos vacíos llegan como `_` o `-`. No usar el feed por estación si
  se tiene el de prefijo: una sola petición por provincia basta.
- **Importante para feeds grandes:** un prefijo de provincia puede
  devolver cientos de items. No hay paginación; el filtrado por radio se
  hace tras parsear. Medir el tamaño de respuesta de un par de
  provincias densas (Barcelona, Madrid) y, si supera ~1-2 MB, plantear
  límite de estaciones devueltas por la API (parámetro `limit`, por
  defecto 50, ordenadas por distancia).

#### B. Tabla de provincias (`lib/meteoclimaticProvinces.ts`)

Estructura:

```typescript
export interface MeteoclimaticProvince {
  prefix: string          // p. ej. 'ESCAT08'
  name: string            // 'Barcelona'
  latMin: number; latMax: number; lonMin: number; lonMax: number
  centroid: [number, number]
}
export const PROVINCES: MeteoclimaticProvince[] = [ /* ~52 entradas */ ]

export function resolveMeteoclimaticPrefix(lat: number, lon: number): string | null
```

Construcción del prefijo: `'ES' + trigramaCCAA + códigoINE` (INE de 2
dígitos: Barcelona 08, Madrid 28, València 46, Zaragoza 50…).
**Trigramas confirmados** por el código existente: `CAT` (Catalunya),
`MAD` (Madrid), `PVA` (Com. Valenciana). El resto hay que validarlos
empíricamente — método concreto:

1. Abrir el directorio público `https://www.meteoclimatic.net/` →
   navegación por territorio: la URL/código de cada provincia aparece en
   los enlaces del árbol.
2. Verificación programática: `curl` a
   `https://meteoclimatic.net/feed/rss/{candidato}` (con las cabeceras
   de arriba); un prefijo válido devuelve RSS con `<item>`; uno inválido
   devuelve feed vacío o error.
3. Dejar el script de verificación en `scripts/verify-meteoclimatic-prefixes.mjs`
   para re-validar en el futuro (no se ejecuta en CI; es manual).

Bounding boxes y centroides provinciales: usar límites administrativos
aproximados (basta precisión de ~10 km; el filtrado fino lo hace el
radio). Fuente sugerida: dataset de provincias del IGN o bboxes
calculados de Natural Earth; embebidos como literales, sin dependencia
nueva.

Algoritmo de `resolveMeteoclimaticPrefix`:

```
candidatas = provincias cuya bbox contiene (lat, lon)
si candidatas vacía → null                       // fuera de España
si una → su prefix
si varias (bboxes solapan en fronteras) → la de centroide más cercano
```

Casos especiales a cubrir en tests: Canarias y Baleares (bboxes
disjuntas del peninsular), Ceuta/Melilla si Meteoclimatic las tiene
(validar; si no, excluir de la tabla), punto en mar cercano a costa
(debe resolver a la provincia costera: si el bbox no lo contiene,
aplicar fallback por centroide a < 100 km antes de devolver `null`).

#### C. Distancias (`lib/geoDistance.ts`)

```typescript
export function haversineKm(a: [number, number], b: [number, number]): number
export function withDistance<T extends { lat: number; lon: number }>(
  stations: T[], center: [number, number]
): (T & { distanceKm: number })[]   // no filtra: anota y deja ordenar/filtrar al llamador
```

Radio terrestre 6371 km. Tests con pares conocidos (BCN–MAD ≈ 505 km,
mismo punto = 0, antípodas).

#### D. Contrato de la API extendida (`app/api/meteoclimatic/route.ts`)

Se mantiene el modo actual `?station={código}` (retrocompatible) y se
añade el modo por coordenadas:

```
GET /api/meteoclimatic?lat=41.39&lon=2.16&radius=30&limit=50
```

| Parámetro | Validación | Default |
|-----------|------------|---------|
| `lat` | -90..90 (rechazar fuera de rango → 400, formato de error de `docs/CONVENCIONES.md` §5) | — |
| `lon` | -180..180 | — |
| `radius` | 1..200 km | 30 |
| `limit` | 1..200 | 50 |

Respuesta (200):

```json
{
  "stations": [ { ...MeteoclimaticObservation, "distanceKm": 4.2 } ],
  "prefix": "ESCAT08",
  "fetchedAt": "2026-06-10T12:00:00Z"
}
```

Sin cobertura (prefijo `null`): 200 con
`{ "stations": [], "prefix": null, "uncovered": true }` — no es un
error; la UI decide el empty state.

Flujo interno: validar params → `resolveMeteoclimaticPrefix` →
`fetchStationData(prefix)` (cacheada, ver abajo) → `withDistance` →
filtrar `≤ radius` → ordenar asc → cortar a `limit`.

Caché: reutilizar el mecanismo existente de la ruta con **clave por
prefijo** (`meteoclimatic:{prefix}`), nunca por lat/lon, para que dos
ciudades de la misma provincia compartan hit. TTL servidor 2 min +
cabeceras `Cache-Control: public, s-maxage=120, stale-while-revalidate=300`
(las actuales de la ruta). El rate limit existente se mantiene.

#### E. Cableado de UI

- `StationDashboard.tsx`:
  - Props nuevas: `position: [number, number] | null` y
    `placeName?: string`.
  - Query Meteoclimatic: `queryKey: ['meteoclimatic', lat1dec, lon1dec, radius]`
    (coordenadas redondeadas a 1 decimal, convención de
    `docs/CONVENCIONES.md` §3) → `GET /api/meteoclimatic?lat=&lon=&radius=`.
    `enabled: includeMeteo && position !== null`. `includeMeteo` pasa a
    `true` por defecto.
  - AEMET: misma query actual (`['aemet-stations']`, devuelve toda
    España) + `withDistance` y filtro por radio en cliente. El filtrado
    por `REGIONS` bbox (`StationDashboard.tsx:109-119`) se elimina; el
    `<select>` de regiones se sustituye por un selector de radio
    (10/30/60 km) con la etiqueta «Cerca de {placeName}».
  - Dedup AEMET/Meteoclimatic: mantener el criterio actual (~0.01° de
    proximidad) pero sobre estructuras indexadas, no el bucle O(n²)
    actual (ver bug B5 en S8).
  - Orden: por `distanceKm` ascendente; `StationCard` muestra la
    distancia («4,2 km») junto al nombre.
- `home-content.tsx:722`: `<StationDashboard position={position} placeName={placeName} />`
  (ambos ya existen en el estado del componente).
- i18n (`lib/i18n.ts`), claves nuevas ES/EN: `nearLabel`
  («Cerca de»/«Near»), `noMeteoCoverage`, `noStationsRadius`
  («No hay estaciones a menos de {km} km»), `expandRadius`
  («Ampliar a {km} km»).

#### F. Fixtures de test

Crear `lib/__tests__/fixtures/meteoclimatic-province.xml` con un feed
real (anonimizado si hace falta) de un prefijo de provincia con ≥3
estaciones, incluyendo: una con todos los campos, una con campos vacíos
(`_`/`-`) y una sin `georss:point` (el parser actual le pone lat/lon 0
— ver bug B13 en S8: debe descartarse en modo por coordenadas para no
fabricar distancias falsas).

### Tareas

- [x] **5.1** Validar trigramas/prefijos contra meteoclimatic.net
  (método de la sección B) y crear `lib/meteoclimaticProvinces.ts` con
  la tabla completa + `resolveMeteoclimaticPrefix` + script
  `scripts/verify-meteoclimatic-prefixes.mjs`.
- [x] **5.2** Crear `lib/geoDistance.ts` (`haversineKm`, `withDistance`,
  sección C).
- [x] **5.3** Extender `app/api/meteoclimatic/route.ts` con el modo
  `?lat&lon&radius&limit` según el contrato de la sección D (validación,
  caché por prefijo, respuesta `uncovered`).
- [x] **5.4** `StationDashboard.tsx`: props `position`/`placeName`,
  queries y filtrado por radio, selector de radio en lugar de regiones,
  orden y distancia en `StationCard` (sección E).
- [x] **5.5** `home-content.tsx:722`: pasar `position` y `placeName`;
  comprobar que el cambio de ciudad con el tab abierto refresca las
  estaciones.
- [x] **5.6** Empty states e i18n según la sección E; descartar
  estaciones sin coordenadas en modo por radio (sección F).
- [x] **5.7** Tests: `lib/__tests__/meteoclimaticProvinces.test.ts`
  (point-in-bbox, solape de fronteras, Canarias/Baleares, fuera de
  España, costa), `geoDistance.test.ts` (distancias conocidas),
  `app/api/meteoclimatic/__tests__/route.test.ts` (modo lat/lon, radio,
  limit, validación 400, `uncovered`, retrocompatibilidad `?station=`),
  actualizar `components/__tests__/StationDashboard.test.tsx`
  (auto-carga al recibir `position`, cambio de radio).

### Criterios de aceptación

- Buscar «Zaragoza» en `CitySearch` y abrir el tab Estaciones muestra
  estaciones AEMET **y** Meteoclimatic a ≤30 km de Zaragoza sin tocar
  ningún selector.
- Cambiar de ciudad actualiza las estaciones sin recargar la página.
- Una ciudad sin cobertura (p. ej. Berlín) muestra empty state claro, sin
  error.
- `npm test` y `npm run lint` en verde.

### Riesgos

| Riesgo | Mitigación |
|--------|------------|
| El patrón de prefijos no es uniforme en todas las CCAA | Tarea 5.1 valida contra el directorio real antes de codificar la tabla |
| Feeds de provincia grandes (muchas estaciones) | Filtrado por radio en servidor (5.3) y cache por prefijo |
| Meteoclimatic caído o bloqueando | Ya hay retry + User-Agent en `lib/meteoclimatic.ts`; AEMET sigue funcionando de forma independiente |

---

## Sprint 6 — Refrescar la última búsqueda de modelos desde móvil

### Contexto y problema

En móvil (retrato) la única señal de frescura es un texto pasivo
«Actualizado 2h» en la cabecera (`home-content.tsx:368-370`, `md:hidden`).
El `RefreshButton` existe (`components/RefreshButton.tsx`) pero vive en la
toolbar de desktop (`home-content.tsx:517`) y dentro del menú hamburguesa
(`:599`), donde queda enterrado. Además:

- `POST /api/refresh` tiene un cooldown de 4 h; cuando responde
  `skipped`, el cliente **no refetchea nada** — el usuario no obtiene ni
  siquiera los datos más frescos del caché de servidor.
- Existe `lib/usePullToRefresh.ts` completo y testeable pero **sin usar**.

### Diseño

1. **Indicador accionable.** El texto «Actualizado X» de la cabecera
   móvil se convierte en botón (icono ↻ + edad) que dispara el refresco.
   Touch target ≥ 44 px, `aria-label` con timestamp exacto.
2. **Pull-to-refresh.** Integrar `usePullToRefresh` en el contenedor
   principal de contenido en viewports táctiles: indicador visual de
   arrastre (progreso + spinner) y misma acción de refresco.
3. **Semántica de refresco en dos niveles.** La acción siempre hace
   ambas cosas:
   - `POST /api/refresh`: si el cooldown lo permite, purga el caché de
     servidor (modelos nuevos de Open-Meteo).
   - Invalidación react-query (`forecast`, `marine`, `aemet-stations`,
     `meteoclimatic`, `refresh-status`): garantiza re-descarga de la
     última búsqueda aunque el cooldown haya saltado (`skipped`).
   El feedback distingue los dos casos: «Modelos actualizados» vs «Datos
   recargados · nuevos modelos en Xm» (toast existente, no solo el texto
   diminuto del botón).
4. **Estado visible.** El botón muestra cuenta atrás del cooldown
   (deshabilitar solo durante el request en vuelo, nunca por cooldown:
   recargar la última búsqueda siempre está permitido).

### Tareas

- [x] **6.1** Extraer la acción de refresco de `RefreshButton.tsx` a un
  hook `lib/useRefresh.ts` (mutación + invalidaciones + estado
  `{ ageMs, canRefresh, cooldownRemainingMs }`) reutilizable por botón,
  cabecera móvil y pull-to-refresh.
- [x] **6.2** `home-content.tsx:368-370`: convertir el indicador móvil en
  botón accionable con spinner durante el refetch y edad formateada
  (`formatAge`); mantenerlo visible también en landscape.
- [x] **6.3** Integrar `usePullToRefresh` sobre el contenedor de
  contenido (solo `pointer: coarse`); indicador de arrastre con
  `pullDistance` y `refreshing`; respetar `prefers-reduced-motion`.
- [x] **6.4** Ampliar `onSuccess` del refresco: invalidar también
  `marine`, `aemet-stations` y `meteoclimatic` (hoy solo `forecast`,
  `RefreshButton.tsx:45`); toast con el resultado real (refrescado vs
  recargado por cooldown).
- [x] **6.5** i18n de los nuevos mensajes y `aria-live` para el resultado
  del refresco.
- [x] **6.6** Tests: `lib/__tests__/useRefresh.test.ts` (invalidaciones
  en ambos casos, cooldown), `usePullToRefresh.test.ts` (umbral,
  scrollTop>0 no dispara), actualizar
  `components/__tests__/RefreshButton.test.tsx` si cambia el contrato.

### Criterios de aceptación

- En un móvil en retrato, tirar hacia abajo desde el inicio de la página
  o tocar el indicador de la cabecera re-descarga la previsión de la
  última búsqueda (se observa request a `/api/forecast` y actualización
  de la UI), incluso con el cooldown de 4 h activo.
- El usuario ve feedback claro de si hubo modelos nuevos o solo recarga.
- Desktop no cambia de comportamiento (el botón de toolbar usa el mismo
  hook).
- `npm test` y `npm run lint` en verde.

### Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Pull-to-refresh en conflicto con el scroll del navegador | El hook ya exige `scrollTop === 0`; añadir `overscroll-behavior-y: contain` al contenedor |
| Refrescos repetidos machacando Open-Meteo | El cooldown de servidor sigue protegiendo la purga; la recarga cliente sirve desde caché de servidor (hit barato) |
| Doble disparo (botón + gesto simultáneos) | Estado compartido en `useRefresh`: ignora si ya hay mutación en vuelo |

---

## Sprint 7 — Mejoras estéticas (mobile y desktop)

### Contexto

La app es densa y funcional pero con deuda visual: tipografías de 9–10 px
generalizadas, jerarquía plana (todo bordes grises sobre `#0a0a0a`),
menú hamburguesa que esconde acciones primarias en móvil, y un modo
landscape en móvil que ya reutiliza la toolbar de desktop
(`hidden md:flex landscape:flex`, `home-content.tsx:418`) pero sin
optimizar el espacio vertical. Stack: Tailwind 4 con `@theme` en
`app/globals.css`, variante custom `landscape`, temas dark/light vía
`html.light`.

### Propuestas (priorizadas)

**P1 — Fundamentos (alto impacto, bajo riesgo)**

1. **Tokens de diseño en `@theme`** (`app/globals.css`): escala
   tipográfica mínima de 11 px (eliminar `text-[9px]`/`text-[10px]` en
   textos informativos; reservar tamaños mínimos para badges), radios y
   espaciados consistentes, colores semánticos
   (`--color-surface`, `--color-surface-raised`, `--color-accent`) en
   lugar de grises sueltos, para que dark/light queden simétricos.
2. **Jerarquía de superficies**: cards con fondo elevado sutil
   (`surface-raised`) en vez de solo borde; sombra suave únicamente en
   elementos flotantes (popovers, toasts) como ya es convención.
3. **Estados de foco e interacción unificados**: anillo de foco visible
   (`focus-visible`), hover consistente en pills/botones, transiciones de
   150 ms con `prefers-reduced-motion` respetado.

**P2 — Mobile retrato**

4. **Barra de pestañas inferior fija** (Modelos / Estaciones / Mapa) con
   `env(safe-area-inset-bottom)`, sustituyendo la navegación enterrada en
   el menú hamburguesa; el menú queda solo para acciones secundarias
   (CSV, tema, idioma).
5. **Touch targets ≥ 44 px** en pills de métricas/modelos y controles de
   la cabecera; más aire vertical entre secciones (la densidad actual es
   de desktop).
6. **Cabecera compacta en scroll**: al hacer scroll hacia abajo la
   cabecera sticky reduce a una línea (buscador colapsado a icono),
   recuperándose al subir.

**P3 — Mobile landscape ≈ desktop**

7. **Layout de dos columnas en landscape**: gráfico a la izquierda,
   tabla/resumen a la derecha (`landscape:grid-cols-2`), aprovechando que
   el mapa ya se oculta (`landscape:hidden`); la toolbar compartida con
   desktop se mantiene como está.
8. **Altura del gráfico adaptada** a viewports bajos
   (`@media (orientation: landscape) and (max-height: 480px)`).

**P4 — Desktop**

9. **Cabecera con identidad**: título + icono con algo de carácter
   (degradado sutil en el acento), agrupación visual de la toolbar en
   clusters (vista / datos / acciones) con separadores, en lugar de la
   fila plana actual de 15+ controles.
10. **Tabla de insights**: cabecera sticky, zebra sutil, alineación
    numérica tabular (`font-variant-numeric: tabular-nums`).
11. **Skeletons y empty states ilustrados** coherentes (los componentes
    de `Skeletons.tsx` existen; unificar su uso en tabs de estaciones y
    gráfico).
12. **Refinar tema claro**: contraste AA en textos secundarios (varios
    grises actuales quedan por debajo sobre `#f8f9fa`).

### Tareas

- [x] **7.1** Definir tokens en `app/globals.css` (`@theme`) y documentar
  la paleta semántica en `docs/CONVENCIONES.md`. (P1.1)
- [x] **7.2** Migrar componentes a los tokens: `StationCard`,
  `DailySummary`, `InsightsTable`, pills, toolbar. Sin cambios de
  comportamiento; diff solo de clases. (P1.2, P1.3)
- [x] **7.3** Implementar bottom tab bar móvil + safe-area; mover
  acciones secundarias al menú; eliminar entradas duplicadas. (P2.4)
- [x] **7.4** Auditoría de touch targets y tipografía mínima en móvil;
  subir tamaños y espaciado. (P2.5)
- [x] **7.5** Cabecera colapsable en scroll (móvil retrato). (P2.6)
- [x] **7.6** Grid de dos columnas y altura de gráfico en landscape.
  (P3.7, P3.8)
- [x] **7.7** Desktop: clusters de toolbar, cabecera, tabla
  (sticky + tabular-nums), tema claro AA. (P4.9–P4.12)
- [x] **7.8** Pasada de QA visual: matriz de capturas
  (375×667 retrato, 667×375 landscape, 768, 1280, dark/light) antes y
  después; verificación con `npm run dev` en cada breakpoint.
- [x] **7.9** Tests de regresión: los tests de componentes existentes no
  dependen de clases concretas; añadir test del tab bar (navegación entre
  tabs) y de la cabecera colapsable si lleva lógica JS.

### Criterios de aceptación

- Ningún texto informativo por debajo de 11 px; touch targets ≥ 44 px en
  móvil.
- Navegación principal accesible con una mano en móvil retrato (tab bar
  inferior).
- En landscape móvil, gráfico y tabla son visibles simultáneamente sin
  scroll horizontal.
- Tema claro pasa contraste AA en textos primarios y secundarios.
- Sin regresiones funcionales: `npm test` y `npm run lint` en verde.

### Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Refactor de clases rompe layouts no cubiertos por tests | Matriz de capturas (7.8) antes/después; migración por componente, no global |
| Bottom bar tapa contenido | Padding inferior equivalente + safe-area en el contenedor de contenido |
| Cambios en Next 16 / Tailwind 4 | Leer `node_modules/next/dist/docs/` antes de tocar layout/CSS global |

---

## Sprint 8 — Corrección de errores

### Contexto

Catálogo resultante de la auditoría del 2026-06-10 (revisión de código de
`app/`, `lib/`, `components/`, rutas API y service worker, contrastada
con `docs/CONVENCIONES.md`). Estado de las puertas de calidad en el
momento de la auditoría: `npm test` **244/244 en verde**;
`npm run lint` **1 error + 10 warnings**.

Cada bug lleva confianza (`seguro` = verificado leyendo/calculando;
`probable`/`posible` = requiere reproducción). Los tres de severidad
alta están verificados de forma independiente. **Regla del sprint:**
cada fix incluye un test de regresión que falla antes del cambio.

### Severidad ALTA

**A1 — `getLocationNow` desplaza «ahora» según la zona horaria del navegador** · seguro

- `lib/dateUtils.ts:34-38` (consumido en `app/home-content.tsx:295-304`).
- El término `localOffsetMs = getTimezoneOffset() * 60000` sobra: para la
  hora de pared de la ubicación en formato «fake-UTC» basta
  `now.getTime() + utcOffsetSeconds * 1000`. Verificado: navegador en
  Madrid (UTC+2) mirando una ciudad UTC+2 → resultado 2 h en el pasado;
  navegador en Nueva York (UTC−4) → 4 h en el futuro. Solo es correcto
  con el navegador en UTC.
- Impacto: `startIndex` recorta mal la serie, el botón «Now»/«+0h» no
  apunta a la hora actual y `nowOffset` desalinea el heatmap.
- Fix: `return new Date(now.getTime() + utcOffsetSeconds * 1000)`.

**A2 — El dedup de AEMET se queda con la observación más antigua (hasta ~24 h)** · probable

- `components/StationDashboard.tsx:64-68`.
- `/observacion/convencional/todas` devuelve ~24 h de observaciones por
  estación ordenadas ascendentemente por `fint`; el bucle
  `if (!seen.has(s.idema)) seen.set(...)` conserva la **primera** =
  la más antigua. El dashboard muestra como actuales datos de ayer.
- Fix: comparar `fint` y conservar la observación más reciente por
  `idema`. Confirmar antes el orden real del feed (tarea 8.1).

**A3 — `?metric=` inválido en la URL tumba toda la app** · seguro

- `lib/useUrlState.ts:30-31` acepta `metric` sin whitelist →
  `components/ColorLegend.tsx:26-29` hace `SCALES[metric].stops[0]` sobre
  `undefined` → TypeError → ErrorBoundary a pantalla completa (el mapa
  está visible por defecto en desktop). `MapPicker.fetchHeatmapGrid`
  también lanza. Cualquier enlace compartido malformado rompe la app.
- Fix: validar `metric` contra `METRICS` en `parseUrlParams`, igual que
  ya se hace con `bucket` (`ALLOWED_BUCKETS`, `useUrlState.ts:44-45`).

### Severidad MEDIA

| ID | Bug | Ubicación | Conf. | Dirección del fix |
|----|-----|-----------|-------|-------------------|
| M1 | Viento AEMET en m/s mostrado como km/h (Meteoclimatic sí da km/h; se mezclan en el mismo dashboard) | `StationDashboard.tsx:39`, `StationMap.tsx:71`, `StationCard.tsx:46` | probable | Multiplicar `vv`/`vmax` × 3.6 en `mapAemet` |
| M2 | SW: HTML cache-first con `weather-v1` fijo → tras un deploy el HTML cacheado referencia chunks inexistentes (app rota hasta 2ª recarga); además cachea cada URL con query como entrada separada | `public/sw.js:1,31-43`, registro en `app/layout.tsx:58-62` | probable | Network-first para `mode === 'navigate'`, versionar `CACHE_NAME` por build, limitar entradas |
| M3 | Mismatches de hidratación sistemáticos: `matchMedia` en initializer (`home-content.tsx:64`), `location.search` (`useUrlState.ts:87-108`), localStorage/navigator (`LocaleContext.tsx:15-23`, `ThemeContext.tsx:15-23`), `SavedLocations.tsx:31` | varios | seguro | Inicializar con valor de servidor y ajustar en `useEffect` |
| M4 | CSV exporta horas locales etiquetadas como UTC (`toISOString()` sobre fechas «fake-local» añade `Z`) | `lib/exportCsv.ts:17` | seguro | Exportar sin sufijo `Z` o convertir a UTC real con `utcOffsetSeconds` |
| M5 | «Hoy/Mañ» de InsightsTable compara día de la ubicación (`getUTCDate`) con día del navegador (`getDate`) | `components/InsightsTable.tsx:144-153` | seguro | Usar `getLocationNow(utcOffsetSeconds)` + `getUTC*` (tras corregir A1) |
| M6 | Cache poisoning: `timezone` excluida de la clave de caché pero sí cambia la respuesta (`hourly.time`, `utc_offset_seconds`); una petición con `timezone=UTC` envenena la celda 4 h | `lib/cacheKey.ts:13`, `app/api/forecast/route.ts:54-69`, `app/api/marine/route.ts` | probable | Incluir `timezone` en la clave o forzar `timezone=auto` server-side |
| M7 | `POST /api/refresh` purga forecast pero no marine (`purgeAllMarineCache` existe y no se usa); tras refresh se mezclan pasadas de modelo distintas | `app/api/refresh/route.ts:26-31`, `lib/marineCache.ts:75` | seguro | Añadir `await purgeAllMarineCache()` (encaja con S6, tarea 6.4) |
| M8 | (a) El botón «Reintentar» del bloque de error solo refetchea AEMET, no Meteoclimatic; (b) `const error = aemetQ.error \|\| (includeMeteo && meteoQ.error)` puede valer `false` y se castea `(error as Error)` | `StationDashboard.tsx:123,196-203` | seguro | Refetch de ambas queries; `aemetQ.error ?? (includeMeteo ? meteoQ.error : null)` |
| M9 | Bboxes de `REGIONS` recortan estaciones legítimas del feed pedido (p. ej. Maresme: Mataró lon 2.45 > `lonMax 2.3` de BCN) — descarte silencioso | `lib/meteoclimatic-types.ts:46-55`, `StationDashboard.tsx:109-113` | probable | Desaparece con S5 (filtrado por radio); si S8 va antes, no aplicar bbox a estaciones del feed regional |
| M10 | Validación de entrada ausente en rutas API: forecast/marine reenvían `searchParams` sin validar rangos; `POST /api/locations` acepta `latitude`/`longitude` de cualquier tipo (un string guardado → TypeError en cliente con `.toFixed`) y `name` sin límite; `DELETE` pasa NaN a SQL; geocode reenvía todo al upstream; POST/DELETE de locations sin rate limit | `app/api/*/route.ts` | seguro | Validar tipos/rangos → 400 con formato de `CONVENCIONES.md` §5 |
| M11 | El mapa de estaciones resetea zoom/encuadre cada 5 min: `AutoFitBounds` depende de la identidad del array `stations`, que cambia en cada `refetchInterval` | `StationMap.tsx:84-94`, `StationDashboard.tsx:70,87` | probable | Hacer `fitBounds` solo cuando cambie la clave derivada (lista de códigos) |
| M12 | Selección «solo Marine» rompe la UI: `marine_global.maxHours: 0` → `effectiveMaxHours=0` → slider `max=-1`, tabla/resumen/CSV vacíos; relacionado: «All» de ModelSelector compara longitudes de listas distintas (9 vs 10) y nunca aparece activo | `lib/models.ts:19`, `app/home-content.tsx:288-291,325` | probable | Excluir `marine_global` de `maxModelHours` o tratar `maxHours 0` como «sin límite» |
| M13 | Error de lint bloqueante (`react-hooks/refs`): se escribe `stateRef.current` dentro del initializer de `useState` (fase de render). Rompe la puerta `npm run lint` de todos los sprints | `lib/useUrlState.ts:87-108` (escritura en `:106`) | seguro | Mover la asignación al `useEffect` ya existente (`:113` ya la repite — basta eliminar la del initializer) |

### Severidad BAJA

| ID | Bug | Ubicación | Conf. | Dirección del fix |
|----|-----|-----------|-------|-------------------|
| B1 | Atajo `/` roto: busca `input[placeholder="Search city..."]` pero el placeholder real es `"Search..."`; el footer anuncia un atajo que no hace nada | `home-content.tsx:349`, `CitySearch.tsx:92` | seguro | Usar `ref`/`id` en lugar del placeholder |
| B2 | `decodeEntities` no decodifica `&apos;` ni entidades hex («L&apos;Hospitalet» se muestra literal); `&amp;` se reemplaza antes que `&lt;`/`&gt;` → doble decodificación | `lib/meteoclimatic.ts:5-8` | seguro | Añadir `&apos;`/hex; decodificar `&amp;` en último lugar |
| B3 | La banda de spread del gráfico sombrea 0→max en vez de min→max (dos `<Area>` con el mismo `stackId` apilan los valores) | `ModelComparisonChart.tsx:192-193` | probable | Area `min` transparente + Area `max−min` apilada encima |
| B4 | `hour`/`range` de URL sin clamp: `?hour=5000` produce slider fuera de rango y «+5000h»; al reducir el rango `selectedHour` no se reajusta | `useUrlState.ts:36-39`, `home-content.tsx:312-318` | seguro | Clamp de `hour` a `[0, effectiveMaxHours−1]`, whitelist de `range` |
| B5 | Dedup de estaciones O(n²) con materialización de array por iteración (~4.000 AEMET × N Meteoclimatic): jank en móvil al activar Meteoclimatic | `StationDashboard.tsx:98-103` | seguro | Índice por celdas de 0.01° (lo necesita también S5) |
| B6 | `CitySearch` abre el dropdown con un side-effect dentro de `queryFn`: las búsquedas servidas del caché (staleTime 1 h) no lo abren | `CitySearch.tsx:62` | probable | Efecto sobre `results`, no side-effect en `queryFn` |
| B7 | `MapRecenter` re-centra el mapa en cada click porque el efecto depende de `center` además del `recenterToken` | `MapPicker.tsx:45-51` | probable | Depender solo de `token` (leer `center` de un ref) |
| B8 | Las respuestas API no cumplen el contrato de `CONVENCIONES.md` §5: errores `{error: string}` vs `{error:{code,message}}`; `/api/locations` devuelve array plano; `/api/refresh` usa otras claves; `/api/aemet` devuelve **200 con `error`** sin API key (provoca 5 reintentos inútiles del cliente); redondeo de caché 2 decimales vs 1 documentado | todas las rutas + `lib/cacheKey.ts:12` | seguro | Decidir contrato canónico y alinear código **y** doc |
| B9 | `formatAge` sin i18n: en español se muestra «Actualizado now» | `lib/formatAge.ts:4`, `home-content.tsx:369` | seguro | Parametrizar locale (relevante para S6) |
| B10 | `position` no se sincroniza con popstate (el handler actualiza `urlState` pero el mapa/forecast no cambian) y el early-return `Object.keys(parsed).length === 0` impide restaurar defaults al volver a la URL limpia | `home-content.tsx:73`, `useUrlState.ts:128-147` | posible | Derivar `position` de `urlState`; eliminar el early-return |
| B11 | Zoom de pinch deshabilitado (`maximumScale: 1, userScalable: false`): barrera de accesibilidad con tipografías de 9-10 px | `app/layout.tsx:29-35` | seguro | Eliminar ambas restricciones (S7 sube además la tipografía mínima) |
| B12 | `/api/aemet` y `/api/meteoclimatic` sin rate limit (el resto de rutas lo aplican; AEMET tiene cuota por API key) | `app/api/aemet/route.ts`, `app/api/meteoclimatic/route.ts` | seguro | Aplicar `rateLimit` como en las demás rutas |
| B13 | Estaciones Meteoclimatic sin `<georss:point>` reciben lat/lon 0 («Null Island») en vez de descartarse; hoy las oculta el filtro bbox por casualidad, pero S5 (radio) las haría visibles con distancias falsas | `lib/meteoclimatic.ts:40-46` | seguro | Devolver `null` en `parseItem` o marcar sin coordenadas |

Además, limpieza menor: 10 warnings de lint por imports/variables sin
usar (`RefreshButton.tsx:25`, `StationCard.tsx:27`, dep innecesaria en
`StationDashboard.tsx:119` y 7 en archivos de test).

### Verificado sin hallazgo (no perder tiempo aquí)

- Paridad i18n ES/EN completa (el tipo `Record<Locale, …>` la fuerza).
- Parser Meteoclimatic: la regex de código acepta códigos reales
  (`[A-Za-z0-9]+`), el orden lat/lon de `georss:point` es correcto,
  `bearingToDirection` correcto.
- `lib/rateLimit.ts` sin fuga de memoria (purga de buckets inactivos OK).

### Tareas

- [x] **8.1** Reproducir y confirmar los bugs `probable`/`posible`
  (A2, M1, M2, M6, M9, M11, M12, B3, B6, B7, B10) antes de tocarlos;
  descartar con nota los que no se confirmen.
- [x] **8.2** Fixes ALTA (A1, A2, A3) + tests de regresión
  (`dateUtils.test.ts` con offsets de navegador simulados vía
  `vi.setSystemTime`/mock de `getTimezoneOffset`; `useUrlState.test.ts`
  con `?metric=foo`; test de dedup AEMET con dos `fint`).
- [x] **8.3** Bloque fechas/zonas horarias (M4, M5) — depende de A1.
- [x] **8.4** Bloque API/caché (M6, M7, M10, B8, B12) — definir primero
  el contrato canónico de respuesta/error (actualizar
  `CONVENCIONES.md` §5 si se decide cambiar la doc en vez del código).
  M9 y B8 quedan pendientes para S5 y un sprint dedicado al
  contrato API respectivamente.
- [x] **8.5** Bloque SW/hidratación (M2, M3) — probado con
  `npm run build && npm start` local.
- [x] **8.6** Bloque estaciones (M1, M8, M11, B5, B13) — M9 y B5
  parcialmente; M8 reescrito para refetchar ambas queries.
- [x] **8.7** Bloque UI/URL (M12, M13, B1, B3, B4, B6, B7, B9, B10, B11).
- [x] **8.8** Limpieza de warnings de lint y dependencia innecesaria de
  `useMemo`.
- [x] **8.9** Pasada final: `npm test` (260/260), `npm run lint`
  (0 errores, 0 warnings), `npm run build` OK.

### Criterios de aceptación

- Los 3 bugs ALTA corregidos con test de regresión que falla en `main`.
- `npm run lint` sin errores ni warnings.
- Ningún parámetro de URL malformado provoca pantalla de error.
- La hora «Now» es correcta con el navegador en una zona horaria
  distinta a la de la ubicación consultada (probar con `TZ=America/New_York`).
- Los bugs `probable` no confirmados quedan documentados como descartados.

### Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Fixes de fechas (A1, M4, M5) rompen casos que «funcionaban» por compensación de errores | Tests con matriz de zonas horarias (UTC, Madrid, Nueva York) antes de cambiar |
| Alinear el contrato API (B8) rompe consumidores (el propio cliente) | Cambiar cliente y servidor en el mismo commit; los tests de rutas existentes cubren el contrato |
| El fix del SW (M2) deja SWs viejos activos en clientes | `skipWaiting` + borrado de caches antiguas en `activate` por nombre versionado |

---

## Orden y dependencias

```
S8 (bugs) ── primero: estabiliza la base; varios fixes tocan los
             mismos archivos que S5/S6 (M7→S6, M8/M9/M11/B5/B13→S5,
             B9→S6, B11→S7) y A1/M13 afectan a cualquier trabajo posterior

S5 (estaciones por ciudad) ──┐
                             ├── independientes entre sí, tras S8
S6 (refresco móvil) ─────────┘

S7 (estética) — en último lugar: toca los mismos componentes que
                S5/S6 y así evita re-trabajo
```

Excepción razonable: M9 puede saltarse en S8 si S5 va inmediatamente
después (el filtrado por radio elimina los bboxes).

## Criterio de cierre por sprint

- [x] Todos los tests pasan (`npm test`) — 260/260
- [x] Lint sin errores (`npm run lint`) — 0/0
- [x] Documentación actualizada (`docs/PLAN.md`, `docs/ESQUEMA_DATOS.md`
  si cambia el contrato de datos)
- [x] Rama `sprint-XX/tarea` + PR; sin commits directos a `main`
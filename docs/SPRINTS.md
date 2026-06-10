# SPRINTS.md — Plan operativo S5–S7

Plan de los tres próximos sprints. Continúa el roadmap de `docs/PLAN.md`
(S1–S4 completados; el detalle de S4/marine está en `docs/SPRINTS_PLAN.md`).

| Sprint | Tema | Objetivo |
|--------|------|----------|
| S5 | Estaciones por ciudad (Meteoclimatic) | Las estaciones del tab "Estaciones" se obtienen automáticamente para la ciudad que el usuario está consultando, incluyendo Meteoclimatic |
| S6 | Refresco desde móvil | En móvil se puede forzar el refresco de la última búsqueda de modelos, no solo ver la antigüedad de la descarga |
| S7 | Mejoras estéticas | Pulido visual en mobile y desktop; mobile horizontal se comporta como desktop |

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

### Tareas

- [ ] **5.1** Crear `lib/meteoclimaticProvinces.ts`: tabla de provincias
  (prefijo, bbox, centroide) + `resolveMeteoclimaticPrefix(lat, lon)`.
  Validar los trigramas de CCAA contra el directorio público de
  meteoclimatic.net (no asumir el patrón sin comprobarlo).
- [ ] **5.2** Crear `lib/geoDistance.ts` con `haversineKm(a, b)` (o
  reutilizar si ya existe lógica equivalente) y
  `filterByRadius(stations, center, km)`.
- [ ] **5.3** Extender `app/api/meteoclimatic/route.ts` para aceptar
  `?lat=&lon=&radius=` además de `?station=`: resuelve el prefijo en
  servidor, hace fetch del feed y devuelve solo estaciones dentro del
  radio, con `distanceKm` por estación. Mantener rate limit y cache
  existentes (clave de caché por prefijo, no por lat/lon, para maximizar
  hits).
- [ ] **5.4** `StationDashboard.tsx`: aceptar props
  `{ position: [number, number] | null, placeName?: string }`; query de
  Meteoclimatic keyed por prefijo resuelto; AEMET filtrado por radio en
  cliente; ordenar cards por distancia y mostrarla en `StationCard`.
- [ ] **5.5** `home-content.tsx:722`: pasar `position` y nombre de la
  ubicación al dashboard; comprobar que el cambio de ciudad con el tab
  abierto refresca las estaciones.
- [ ] **5.6** Empty states e i18n (`lib/i18n.ts`): «Sin cobertura
  Meteoclimatic en esta zona», «No hay estaciones a menos de X km»,
  opción de ampliar radio.
- [ ] **5.7** Tests: `lib/__tests__/meteoclimaticProvinces.test.ts`
  (resolución dentro/fuera de España, fronteras), `geoDistance.test.ts`,
  `app/api/meteoclimatic/__tests__/route.test.ts` (modo lat/lon, radio,
  errores), actualizar `components/__tests__/StationDashboard.test.tsx`
  (auto-carga al recibir `position`).

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

- [ ] **6.1** Extraer la acción de refresco de `RefreshButton.tsx` a un
  hook `lib/useRefresh.ts` (mutación + invalidaciones + estado
  `{ ageMs, canRefresh, cooldownRemainingMs }`) reutilizable por botón,
  cabecera móvil y pull-to-refresh.
- [ ] **6.2** `home-content.tsx:368-370`: convertir el indicador móvil en
  botón accionable con spinner durante el refetch y edad formateada
  (`formatAge`); mantenerlo visible también en landscape.
- [ ] **6.3** Integrar `usePullToRefresh` sobre el contenedor de
  contenido (solo `pointer: coarse`); indicador de arrastre con
  `pullDistance` y `refreshing`; respetar `prefers-reduced-motion`.
- [ ] **6.4** Ampliar `onSuccess` del refresco: invalidar también
  `marine`, `aemet-stations` y `meteoclimatic` (hoy solo `forecast`,
  `RefreshButton.tsx:45`); toast con el resultado real (refrescado vs
  recargado por cooldown).
- [ ] **6.5** i18n de los nuevos mensajes y `aria-live` para el resultado
  del refresco.
- [ ] **6.6** Tests: `lib/__tests__/useRefresh.test.ts` (invalidaciones
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

- [ ] **7.1** Definir tokens en `app/globals.css` (`@theme`) y documentar
  la paleta semántica en `docs/CONVENCIONES.md`. (P1.1)
- [ ] **7.2** Migrar componentes a los tokens: `StationCard`,
  `DailySummary`, `InsightsTable`, pills, toolbar. Sin cambios de
  comportamiento; diff solo de clases. (P1.2, P1.3)
- [ ] **7.3** Implementar bottom tab bar móvil + safe-area; mover
  acciones secundarias al menú; eliminar entradas duplicadas. (P2.4)
- [ ] **7.4** Auditoría de touch targets y tipografía mínima en móvil;
  subir tamaños y espaciado. (P2.5)
- [ ] **7.5** Cabecera colapsable en scroll (móvil retrato). (P2.6)
- [ ] **7.6** Grid de dos columnas y altura de gráfico en landscape.
  (P3.7, P3.8)
- [ ] **7.7** Desktop: clusters de toolbar, cabecera, tabla
  (sticky + tabular-nums), tema claro AA. (P4.9–P4.12)
- [ ] **7.8** Pasada de QA visual: matriz de capturas
  (375×667 retrato, 667×375 landscape, 768, 1280, dark/light) antes y
  después; verificación con `npm run dev` en cada breakpoint.
- [ ] **7.9** Tests de regresión: los tests de componentes existentes no
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

## Orden y dependencias

```
S5 (estaciones por ciudad) ──┐
                             ├── independientes entre sí
S6 (refresco móvil) ─────────┘
S7 (estética) — preferible en último lugar: toca los mismos
                componentes que S5/S6 y así evita re-trabajo
```

## Criterio de cierre por sprint

- [ ] Todos los tests pasan (`npm test`)
- [ ] Lint sin errores (`npm run lint`)
- [ ] Documentación actualizada (`docs/PLAN.md`, `docs/ESQUEMA_DATOS.md`
  si cambia el contrato de datos)
- [ ] Rama `sprint-XX/tarea` + PR; sin commits directos a `main`

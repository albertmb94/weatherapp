# SPRINT_9.md — Estabilización + features + observabilidad

Sprint 9. Cierra la auditoría posterior a S8, añade funcionalidades nuevas y
deja el proyecto listo para crecer con calidad.

Estado al cerrar S8: 291/291 tests, 0 warnings lint, build OK.

---

## Tabla de fases

| Fase | Tema | Tipo |
|------|------|------|
| 1 | Bugs altos post-S8 (B-NEW-1 a B-NEW-5) | Estabilización |
| 2 | Bugs medios post-S8 (B-NEW-6 a B-NEW-12) | Estabilización |
| 3 | Radio por defecto 30 km → 10 km | Producto |
| 4 | Mejoras UX/UI (M-UI-1 a M-UI-6) | UX |
| 5 | Features pequeñas (F-10, F-11, F-12) | Features |
| 6 | Features grandes (F-5, F-9, F-11) | Features |
| 7 | Tests E2E Playwright (M-ROB-1) | Calidad |
| 8 | Observabilidad con Sentry (M-ROB-2) | Calidad |

Dependencias: 1, 2 → independientes. 3 → tras 1 y 2. 4 → tras 3. 5 → tras 4.
6 → tras 5. 7 → tras 6. 8 → independiente (puede ir al final).

---

## Fase 1 — Bugs altos

Cada fix incluye un test de regresión que falla antes del cambio (regla
heredada de S8).

### B-NEW-1 · `useUrlState` no restaura defaults al volver a URL limpia

- **Ubicación:** `lib/useUrlState.ts:130-149`
- **Síntoma:** El handler `onPopState` hace `if (Object.keys(parsed).length === 0) return`
  y abandona el sync. Al pulsar "atrás" hasta la URL sin query, la app
  conserva la última ciudad en lugar de volver a los defaults (Badalona).
- **Fix:** Eliminar el early-return. En `setState` hacer merge completo
  con defaults primero, luego con el estado previo, luego con `parsed`:
  `setState(prev => ({ ...defaults, ...prev, ...parsed }))`. Mantener
  `hasChange` solo como optimization para evitar un `setState` redundante.
- **Test de regresión:**
  `lib/__tests__/useUrlState.test.ts` añadir test que simula popstate a URL
  vacía tras cambiar a "Zaragoza" y verifica que vuelve a `lat=41.45,
  lon=2.2475`.

### B-NEW-2 · `DailySummary` usa 12:00 UTC como mediodía en cualquier huso

- **Ubicación:** `components/DailySummary.tsx:98`
- **Síntoma:** `if (t.getUTCHours() === 12) current.noonIndex = i`. Para
  una ciudad CEST (UTC+2) el "mediodía local" son las 10:00 UTC, así que
  al pulsar la card el slider salta a la hora UTC equivalente (10:00 o
  14:00 local).
- **Fix:** Calcular la hora local objetivo:
  `const targetUtcHour = (12 - Math.round(utcOffsetSeconds / 3600) + 24) % 24`.
  Si `t.getUTCHours() === targetUtcHour` asignar `noonIndex`. Si no hay
  coincidencia exacta, usar el índice más cercano a mediodía local.
- **Props:** Pasar `utcOffsetSeconds` desde `DailySummary` (el caller ya
  lo tiene en `home-content.tsx`).
- **Test:** `components/__tests__/DailySummary.test.tsx` con series de 48 h
  en UTC+2 verificando que `onSelectHour` recibe el índice del 12 local.

### B-NEW-3 · Pill "All Metrics" está muerta

- **Ubicación:** `components/MetricPills.tsx`, `lib/models.ts`
- **Síntoma:** "All Metrics" aparece en el selector y se selecciona, pero
  el chart (`ModelComparisonChart.tsx:55`), el heatmap (`MapPicker.tsx:187`)
  y la leyenda la colapsan a `temperature`. El usuario ve el toggle "activo"
  sin efecto.
- **Decisión:** Eliminar la métrica `all` y la pill correspondiente. Es
  UI muerta y nunca estuvo documentada como funcional.
- **Fix:**
  - `lib/models.ts`: quitar `id: 'all'` del union y de METRICS.
  - `lib/openMeteo.ts`: el filtro `metrics.filter(m => m.id !== 'all')`
    se simplifica a `metrics`.
  - `components/MetricPills.tsx`: quitar el icono `all` y la pill
    correspondiente.
  - `components/ModelComparisonChart.tsx:55`: el fallback
    `metric === 'all' ? 'temperature' : metric` se quita.
  - `components/MapPicker.tsx:187`: idem.
  - `components/InsightsTable.tsx`, `components/DailySummary.tsx`: revisar
    usos de `metric === 'all'` y `MARINE_METRIC_IDS`.
- **Tests:** actualizar `lib/__tests__/models.test.ts` y
  `components/__tests__/MetricPills.test.tsx`.

### B-NEW-4 · Heatmap repinta con grid obsoleto durante el pan

- **Ubicación:** `components/MapPicker.tsx:335-352` (efecto `move`)
- **Síntoma:** Al arrastrar el mapa el evento `move` se dispara ~60 veces
  por segundo. El throttle a 50 ms sigue disparando un repintado de canvas
  con `gridCells`/`gridSeries` que corresponden al último `moveend`. La
  bilinear interpola sobre celdas que ya no coinciden con la vista → la
  mancha se desplaza pegada al grid original.
- **Fix:** Repintar el canvas en `move` está bien (es barato y mejora la
  percepción de fluidez), pero debe quedar claro que solo se re-renderiza
  el lienzo con los datos actuales. Cambiar el `useEffect` de `move` para
  que use el ref `renderCanvas` y NO cambie `gridCells`/`gridSeries`.
  Renombrar a `useEffect` independiente para mayor claridad.
- **Test:** añadir componente test de `MapPicker` que simule cambio de
  bounds sin moveend y verifique que no se vuelve a fetchar la grid.

### B-NEW-5 · Heatmap ignora los modelos seleccionados si hay >4

- **Ubicación:** `lib/openMeteo.ts:158` (`MAX_HEATMAP_MODELS = 4`)
- **Síntoma:** El usuario activa los 9 modelos terrestres. El chart los
  compara todos pero el heatmap muestra solo una mezcla ponderada de los
  4 top. Inconsistencia visible.
- **Decisión:** Respetar la selección cuando sea posible. Si el usuario
  ha seleccionado ≤4 modelos, usar esos; si son >4, capar a los top-N
  pero **avisar** con un tooltip discreto en el heatmap ("mostrando 4 de
  N modelos"). También exponer `MAX_HEATMAP_MODELS` como prop o constante
  en `heatmapConfig.ts`.
- **Fix:**
  - En `MapPicker` añadir estado `heatmapModelCapHit` que se activa cuando
    se cape más allá de los seleccionados.
  - Mostrar un badge en el `statusLine` ("Heatmap: N modelos capados").
  - No cambiar `MAX_HEATMAP_MODELS` por defecto (4 evita timeouts).
- **Test:** unit test de `fetchHeatmapGrid` que verifique que cuando
  `modelIds.length > MAX_HEATMAP_MODELS`, el param `models` enviado
  contiene solo los capados.

---

## Fase 2 — Bugs medios

### B-NEW-6 · `SavedLocations` lee localStorage solo en primer render

- **Ubicación:** `components/SavedLocations.tsx:31`
- **Fix:** mover la lectura a `useEffect` con `[]` deps para sincronizar
  tras hidratación y tras fallo persistente de la API. Si el `apiLocations`
  vuelve a fallar tras un intento previo, recargar el fallback local.
- **Test:** componente test que mockea fetch fallando y verifica que se
  muestran los locales guardados.

### B-NEW-7 · `DailySummary` corta los días extra sin peek

- **Ubicación:** `components/DailySummary.tsx:155` (`cols = min(days, 7)`)
- **Fix:** usar `min(days.length, 7)` para el grid pero añadir un peek de
  media card adicional (`gridTemplateColumns: repeat(N, calc((100% -
  1.5rem) / 7))` cuando hay más de 7 días). Para días ≤7 mantener el
  reparto actual. Padding-end indica scroll.
- **Test:** visual con Vitest + happy-dom + DOM measurements es complejo;
  saltar test automatizado y verificar manualmente en dev.

### B-NEW-8 · Cluster de controles en `StationDashboard` móvil

- **Ubicación:** `components/StationDashboard.tsx:217-275`
- **Fix:** en mobile portrait, mover el radio selector a una segunda fila
  con etiqueta clara. Añadir separador visual entre "Cerca de X",
  búsqueda, radio y Meteoclimatic.
- **Test:** snapshot test del cluster con un viewport pequeño.

### B-NEW-9 · Tests de `WeatherConditionIcon`

- **Ubicación:** `components/WeatherConditionIcon.tsx`
- **Fix:** crear `components/__tests__/WeatherConditionIcon.test.tsx`
  con tests de:
  - Renderiza un SVG por cada `WeatherIconId`.
  - El `size="lg"` aumenta el `className` con `w-5 h-5`.
  - Acepta className extra.

### B-NEW-10 · `parseOpenMeteoTime` no documenta formatos nuevos

- **Ubicación:** `lib/dateUtils.ts:18-23`
- **Fix:** ampliar el comentario doc explicando el contrato y los
  formatos soportados. Añadir un test con `+05:30` y otro con `+0530` (sin
  dos puntos). Si falla, considerar como input no soportado y devolver
  `iso` sin offset (interpretado como local del navegador → mismo
  problema que antes). Decisión: soportar solo `Z` y `±HH:MM`.

### B-NEW-11 · CSV no incluye unidades ni offset horario

- **Ubicación:** `lib/exportCsv.ts:13-37`
- **Fix:**
  - Insertar una fila de unidades justo debajo del header:
    `Hour,DateTime,Temperature °C,Cloud Cover %,Wind Speed km/h,...`
  - Añadir comentario `# utc_offset_seconds=7200\n` como primera línea.
  - Asegurar que `fakeUtcToLocalIsoString` no añada `Z`.
- **Test:** actualizar `lib/__tests__/exportCsv.test.ts` para verificar
  la fila de unidades y el comentario.

### B-NEW-12 · `fetchHeatmapGrid` abort en cambios de métrica/modelo

- **Ubicación:** `lib/openMeteo.ts:140`, `components/MapPicker.tsx:220-252`
- **Verificación:** el `lastFetchKey.current` cambia con
  `effectiveMetric|selectedModels`, así que la guarda funciona. Confirmar
  con test que `controller.abort()` se llama al cambiar de métrica.
- **Fix:** nada si el test pasa; en caso contrario, mover el abort al
  cleanup del effect y no antes del fetch.

---

## Fase 3 — Radio de estaciones 30 km → 10 km

- **Ubicación:** `components/StationDashboard.tsx:66`
- **Cambio:** `useState(30)` → `useState(10)`. Ajustar también el default
  de URL si existiera (no existe, se gestiona en cliente).
- **i18n:** añadir clave `defaultRadius` por si se quiere mostrar
  explícitamente en el futuro.
- **Test:** actualizar `components/__tests__/StationDashboard.test.tsx`
  (si existe) para verificar el default.

---

## Fase 4 — Mejoras UX/UI (M-UI-*)

### M-UI-1 · Empty state ilustrado en `StationDashboard`

- **Ubicación:** `components/StationDashboard.tsx:289-296`
- **Cambio:** cuando `filtered.length === 0`, mostrar icono SVG
  inline + texto + botón "Ampliar radio" si hay radio bajo.
- **Texto ES/EN:** nuevo i18n `emptyStationsTitle`, `emptyStationsBody`,
  `expandRadiusBtn`.

### M-UI-2 · Tooltip en el slider de hora

- **Ubicación:** `app/home-content.tsx:781-790` (el `<input type="range">`)
- **Cambio:** añadir `<title>` o `aria-valuetext` más descriptivo, y
  opcionalmente un popover que muestre `hourLabel` + valor numérico
  exacto al hacer hover. Mínimo viable: el `aria-valuetext` ya existe,
  añadirlo también a `aria-label`.

### M-UI-3 · Indicador "stale" en `RefreshButton`

- **Ubicación:** `components/RefreshButton.tsx`
- **Cambio:** cuando `ageMs > 4*3600_000` añadir clase CSS que tiña el
  número de amarillo (`text-amber-400`).
- **Test:** unit test simple renderizando con `ageMs` alto.

### M-UI-4 · Toast de cooldown con cuenta atrás

- **Ubicación:** `lib/useRefresh.ts` (`lastOutcome`) +
  `app/home-content.tsx` (toast existente en `:926-930`)
- **Cambio:** en `onSuccess` del mutation en `home-content.tsx`, si
  `lastOutcome.kind === 'cooldown'`, mostrar toast con minutos restantes
  ("Datos recargados · nuevos modelos en 3m"). Si es `refreshed`,
  "Modelos actualizados".
- **Test:** mock del mutation y verificar el toast.

### M-UI-5 · Mini-cards por modelo (extensión de `DailySummary`)

- **Ubicación:** nuevo componente `components/ModelDailyBreakdown.tsx`
- **Cambio:** para el día seleccionado, mostrar una card por modelo
  activo con tmax/tmin/precip. Se monta debajo del `DailySummary`.
- **Test:** unit del componente.

### M-UI-6 · Persistir últimos ajustes en localStorage

- **Ubicación:** `app/home-content.tsx`
- **Cambio:** en mount, si la URL no trae params, restaurar de
  `localStorage.lastView = { metric, models, range }`. Si la URL trae
  params, escribir el snapshot. Es opcional y se documenta en i18n.
- **Test:** componente test que verifica restore en mount.

---

## Fase 5 — Features pequeñas (F-10, F-11, F-12)

### F-10 · Animación de loading del forecast

- **Ubicación:** `app/home-content.tsx:855-861` (skeletons existentes)
- **Cambio:** añadir un fade-in sutil con `prefers-reduced-motion`
  respetado. Skeleton actual ya cubre la mayor parte.

### F-11 · Tema de color por temperatura automático

- **Ubicación:** `lib/ThemeContext.tsx`
- **Cambio:** cuando `theme === 'auto'` (nuevo valor), cambiar entre dark
  y light según la heurística 6/18 hora local de la ubicación actual.
  Requiere pasar `position` al provider o consumirlo dentro de
  `ThemeContext`. Para evitar circular deps, exponer `setSolarHour(h)`
  desde el contexto global.

### F-12 · Exportar PNG del chart

- **Ubicación:** nuevo componente `lib/chartExport.ts` +
  `components/ModelComparisonChart.tsx`
- **Cambio:** botón en la cabecera del chart que serializa el SVG a PNG
  usando `XMLSerializer` + `Image` + canvas. Sin dependencias nuevas.
- **i18n:** `exportPng`.

---

## Fase 6 — Features grandes

### F-5 · PWA offline (shell + último forecast en IndexedDB)

- **Ubicación:** `public/sw.js` (existente), `lib/forecastIndexedDB.ts`
  (nuevo), `app/layout.tsx:58-62`
- **Cambio:**
  - Nuevo `lib/forecastIndexedDB.ts` con helpers `saveLastForecast`,
    `loadLastForecast`.
  - En `home-content.tsx`, después de un fetch exitoso, persistir.
  - En mount, si no hay red y hay cache, mostrar banner "Modo offline
    (última actualización hace Xh)" y servir del IndexedDB.
  - SW: network-first para `/api/forecast`, cache-first para assets.
  - `manifest.json`: añadir `start_url`, `display: standalone`, iconos.
- **Test:** componente test del banner offline.

### F-9 · Short links con BD propia

- **Ubicación:** nuevo `app/api/shorten/route.ts`,
  `lib/shortLinks.ts`, tabla nueva `short_links` en `db.ts`.
- **Cambio:**
  - Tabla `short_links(id TEXT PK, snapshot TEXT, created_at INTEGER)`.
  - POST `/api/shorten` con `{ params: Record<string, string> }` →
    genera id (nanoid de 8 chars), guarda snapshot, devuelve
    `{ id, url: '/s/:id' }`.
  - GET `/s/[id]/route.ts` → busca snapshot, redirige a
    `/?${queryString}`.
  - Botón "Compartir" en desktop toolbar (junto al `navigator.share` que
    ya existe) que crea el short link y lo copia al portapapeles.
- **Test:** API route test con POST + GET.

### F-11 · Dark mode solar (heurística 6/18 local)

- **Ubicación:** `lib/ThemeContext.tsx`, `app/home-content.tsx`
- **Cambio:** aceptar `theme: 'dark' | 'light' | 'auto'`. En modo `auto`,
  el toggle que ya existe pasa por 3 estados. La heurística: hora local
  6-18 → light; resto → dark. Recalcular cada minuto o al cambiar
  posición.
- **Test:** unit test del reducer con hora simulada.

---

## Fase 7 — Tests E2E Playwright

- **Ubicación:** `e2e/` (nuevo directorio)
- **Setup:**
  - Añadir `@playwright/test` a devDependencies.
  - `playwright.config.ts` con un `webServer` que ejecute `npm run dev` y
    apunte a `http://localhost:3000`.
- **Tests iniciales:**
  - `e2e/search.spec.ts`: busca "Badalona", verifica que la URL tiene
    `lat=41.45` y el forecast se muestra.
  - `e2e/stations.spec.ts`: abre tab Estaciones, verifica que aparecen
    estaciones AEMET a ≤10 km.
  - `e2e/marine.spec.ts`: activa el toggle Marine, verifica que aparecen
    las pills marinas.
  - `e2e/share.spec.ts`: copia short link, lo abre en contexto limpio,
    verifica que la vista se restaura.
- **CI:** añadir script `npm run e2e`. No se ejecutará en este sprint
  salvo manualmente, pero queda preparado.

---

## Fase 8 — Sentry

- **Ubicación:** `lib/sentry.ts` (nuevo), `app/layout.tsx`,
  `next.config.ts`
- **Cambio:**
  - `@sentry/nextjs` en dependencies.
  - DSN configurable vía `SENTRY_DSN`.
  - `instrumentation.ts` para inicializar Sentry en servidor.
  - Captura automática de errores en cliente.
  - **Importante:** no capturar eventos si la app está en desarrollo
    sin DSN configurado (no rompe el dev server).
- **Test:** el provider se inicializa solo si hay DSN.

---

## Criterio de cierre del sprint

- [x] Todos los bugs nuevos (B-NEW-1 a B-NEW-12) cerrados con test de
      regresión.
- [x] Default de radio de estaciones en 10 km.
- [x] Todas las mejoras M-UI-* implementadas.
- [x] Features pequeñas F-10, F-11, F-12 listas.
- [x] Features grandes F-5 (PWA), F-9 (short links), F-11 (solar) listas.
- [x] Tests E2E con Playwright configurados y al menos 4 specs.
- [~] Sentry NO llegó a integrarse. Esta casilla estuvo marcada durante
      meses y era falsa: `instrumentation.ts` leía `SENTRY_DSN` e
      importaba `@sentry/nextjs`, pero el paquete nunca se instaló y el
      guard `NEXT_RUNTIME !== 'nodejs'` lo habría dejado sólo en el
      servidor. La captura de errores de cliente se resolvió en su lugar
      con `lib/reportarError.ts` + `/api/client-errors` (2026-09-01).
- [x] `npm test` y `npm run lint` en verde.
- [x] `docs/PLAN.md` actualizado con el sprint.
- [x] Ramas + PR por tarea.

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| La eliminación de `metric: 'all'` rompe consumidores | Búsqueda exhaustiva previa; tests cubren todos los `METRICS` references |
| PWA offline + caché existente se solapan | El SW versionado borra caches antiguas en `activate` |
| Sentry añade peso en bundle | Inicialización lazy, solo si DSN presente |
| Tests E2E flaky por timing | `await expect(...).toBeVisible()` con timeouts generosos, no sleeps fijos |
| Short links DoS | Rate limit en `/api/shorten` (mismo `rateLimit` helper), TTL 90 días |
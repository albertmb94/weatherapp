# SPRINTS_PLAN.md — Funcionalidad de olas

Plan operativo de implementación de la funcionalidad de olas (marine) en la
previsión meteorológica.

## Contexto

Open-Meteo expone un endpoint independiente para datos marinos
(`https://marine-api.open-meteo.com/v1/marine`) con variables horarias
de oleaje. La API **no ofrece desglose por modelo** (un único modelo
global), por lo que los datos se integran como un **modelo virtual**
`marine_global` dentro de la estructura `Record<modelId, Record<metricId,
(number|null)[]>>` ya existente.

## Decisiones de diseño (confirmadas)

| Decisión | Elección |
|----------|----------|
| Encaje con multi-modelo | Modelo virtual `marine_global` (`weight: 0`) |
| Activación | Toggle manual `marine` en UI (URL `?marine=1`) |
| Variables incluidas | `wave_height`, `wave_period`, `wave_direction`, `wind_wave_height`, `wind_wave_period`, `swell_wave_height`, `swell_wave_period` (7 métricas, sin direcciones de wind/swell) |

## Variables a integrar

| `id` | `hourlyParam` | Unidad |
|------|---------------|--------|
| `wave_height` | `wave_height` | m |
| `wave_period` | `wave_period` | s |
| `wave_direction` | `wave_direction` | ° |
| `wind_wave_height` | `wind_wave_height` | m |
| `wind_wave_period` | `wind_wave_period` | s |
| `swell_wave_height` | `swell_wave_height` | m |
| `swell_wave_period` | `swell_wave_period` | s |

## Fases

### Fase 1 — Capa de datos

- [x] **1.1** Añadir las 7 métricas a `lib/models.ts` y el modelo virtual
  `marine_global` (`weight: 0`, `color: '#06b6d4'`, `maxHours: 168`).
- [x] **1.2** Añadir escalas de color a `lib/colorScales.ts` para las 7 métricas.
- [x] **1.3** Crear `lib/marine.ts` con `fetchMarine()`.
- [x] **1.4** Crear `app/api/marine/route.ts` con rate limit, retry y cache.
- [x] **1.5** Extender `lib/forecastCache.ts` con tabla unificada
  `api_cache(kind, cache_key, body, fetched_at)`.
- [x] **1.6** Añadir `buildMarineCacheKey()` a `lib/cacheKey.ts`.

### Fase 2 — Pipeline de fetch

- [x] **2.1** Extender `fetchForecast` en `lib/openMeteo.ts` con
  `includeMarine` para inyectar `marine_global` en `series`.
- [x] **2.2** Añadir toggle `marine` a `app/home-content.tsx` y a
  `lib/useUrlState.ts`.

### Fase 3 — UI

- [x] **3.1** Verificar `components/ColorLegend.tsx` (ya agnóstico a métrica).
- [x] **3.2** Extender `components/InsightsTable.tsx` con columnas de olas
  (visibles solo con `marine` activo) y bypass de `weightedAvg` para
  `marine_global`.
- [x] **3.3** Añadir resumen de olas por día en `components/DailySummary.tsx`.
- [x] **3.4** Verificar `components/ModelComparisonChart.tsx` con un
  único modelo marino (cambio de redondeo de dominio Y).
- [x] **3.5** Actualizar `components/ModelSelector.tsx` para incluir
  `marine_global` cuando `marine` está activo.
- [x] **3.6** Verificar `components/MapPicker.tsx` con heatmap de olas.
- [x] **3.7** Verificar `lib/exportCsv.ts` (iteración automática sobre
  `METRICS`).

### Fase 4 — i18n, accesibilidad, empty state

- [x] **4.1** Añadir strings a `lib/i18n.ts`.
- [x] **4.2** `aria-label`, `aria-pressed` en nuevos pills y toggle.
- [x] **4.3** Empty state cuando la ubicación es interior.

### Fase 5 — Tests

Cobertura objetivo: utils puros 100 %, API routes 100 % éxito+error+edge,
componentes críticos (MetricPills, InsightsTable, ModelSelector).

| Archivo de test | Cubre |
|-----------------|-------|
| `lib/__tests__/models.test.ts` | modelo virtual, nuevas métricas |
| `lib/__tests__/colorScales.test.ts` | 7 nuevas escalas |
| `lib/__tests__/cacheKey.test.ts` | `buildMarineCacheKey` |
| `lib/__tests__/marine.test.ts` | parseo y forma de `fetchMarine` |
| `lib/__tests__/marineCache.test.ts` | tabla unificada, TTL |
| `app/api/marine/__tests__/route.test.ts` | hit/miss/stale, retry, rate limit |
| `components/__tests__/MetricPills.test.tsx` | filtro `group` |

### Fase 6 — Documentación

- [x] Actualizar `docs/PLAN.md` (alcance, stack, árbol de carpetas).
- [x] Actualizar `docs/ESQUEMA_DATOS.md` (flag `marine`, modelo virtual).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Payload extra (7 cols × 168h) | Solo se piden con `marine=1`; cache 4h |
| Comparación terrestre vs marino | `weight: 0` en `marine_global`; columnas separadas en la tabla |
| Null en ubicaciones interiores | Empty state explícito |
| UI saturada con 7 pills nuevas | Pills agrupadas, solo con `marine` activo |
| Cambios en Next 16 | Leer `node_modules/next/dist/docs/` antes de cambios |

## Criterio de cierre

- [ ] Todos los tests pasan (`npm test`)
- [ ] Lint sin errores (`npm run lint`)
- [ ] Documentación actualizada
- [ ] Commit + push a `main`

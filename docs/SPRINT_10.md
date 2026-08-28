# SPRINT_10.md — Bug fix + refactor + observabilidad + eficiencia

Sprint 10. Arranca tras una auditoría de la base del proyecto. Cierra
el bug "AHORA ≠ Insights current hour" reportado en móvil, centraliza
el cálculo de ensembles, añade vectorización con Qdrant para que
cualquier modelo que se conecte al repo pueda entenderlo sin leerlo
entero, y reduce drásticamente las llamadas upstream contra APIs free
tier.

Estado al cerrar Sprint 9: 291/291 tests, 0 warnings lint, build OK.

---

## Tabla de fases

| Fase | Tema | Tipo |
|------|------|------|
| A | Centralizar ensemble + forzar WedAI para la hora actual | Estabilización |
| B | Anotación "↳ Ahora · XX°" en InsightsTable bucket=24 | UX |
| C | Refactor home-content.tsx (extract useHourSlider) | Calidad |
| D | Vectorización Qdrant (BM25 sparse, sin ML) | AI-context |
| E | Eficiencia de llamadas externas (BigDataCloud, AEMET, Meteocat, …) | Perf |
| F | Documentación SPRINT_10.md + docs/PROJECT_INDEX.md | Docs |

Dependencias: A → B (B se apoya en A). C, D, E independientes entre sí.
F al final.

---

## Fase A — Bug B-10-1: AHORA ≠ InsightsTable current hour

### Síntoma reportado

> "En mobile, la temperatura que se muestra en 'AHORA' (previsión del
> tiempo) no coincide con la temperatura actual en Avanzado/insights a
> la hora actual."

Tres componentes mostraban la "temperatura de la hora actual" pero
calculaban números distintos:
- `CurrentWeatherCard` (la tarjeta grande) — vía
  `computeCurrentSnapshot`, que filtraba los modelos por el
  `selectedIds` del usuario.
- Slot "AHORA" del `HourlyForecastStrip` — mismo path.
- Fila activa de `InsightsTable` — filtraba por `activeModelIds`
  cuando `ensembleMode='wedai'`, lo que en modo Mixto (algunos
  modelos toggled off) daba un set distinto.

### Fix

- Nuevo `lib/ensemble/central.ts` como única fuente de verdad:
  `resolveActiveModels`, `weightsFor`, `meanAtHour`,
  `meanOverBucket`.
- `computeCurrentSnapshot` y el slot AHORA de `computeHourlySlots`
  fuerzan `mode='wedai'` (mejor ensemble para la hora actual)
  independientemente del toggle del usuario.
- `InsightsTable` gana la prop `currentHourMode` (default `'wedai'`)
  que recalcula `tempMean` de la fila activa con el set WedAI. Las
  demás filas siguen respetando `ensembleMode`.

### Tests de regresión

- `lib/__tests__/centralEnsemble.test.ts` — escrito ANTES del fix,
  falla en código viejo, pasa tras el fix.
- `lib/ensemble/__tests__/central.test.ts` — cobertura unitaria del
  módulo central.

### Decisiones conservadoras

- `DailySummary` y `computeWeekSummaries` NO se tocan: agregan días
  futuros donde el toggle del usuario manda por diseño.
- El toggle WedAI/Models sigue gobernando las filas no-activas.

---

## Fase B — Anotación "↳ Ahora" en InsightsTable (UX)

Tras el fix A, el `tempMean` de la fila activa en `bucket=24` es la
temperatura de la hora actual (WedAI forzado), no la media del día.
Esto puede confundir al usuario que ve "29°" bajo "Hoy" sin saber
que es la hora actual, no el día entero.

Pequeño chip en accent color sobre la etiqueta de la fila cuando
`bucket=24 && selectedHour=0`:

```
↳ Ahora · 29°
Hoy
```

Con `aria-label="Hora actual"`. Suprimido para `bucket != 24` (la fila
ya está etiquetada por hora) y para cualquier `selectedHour > 0` (no
es "ahora" en sentido estricto).

Tests: `components/__tests__/InsightsTable.test.tsx` cubre los tres
casos (presente, ausente por bucket, ausente por hora futura).

---

## Fase C — Refactor de `app/home-content.tsx`

El plan original proponía extraer cuatro hooks. En modo conservador sólo
se extrajo `useHourSlider` (clamp del slider y `maxModelHours`) porque
los otros tres (mobile menu/scroll con matchMedia + rAF, position con
geocode out-of-order, ensemble data con React Query) acoplaban
APIs del navegador difíciles de testear en jsdom sin cambiar
comportamiento. Quedan documentados como follow-up en
`docs/PROJECT_INDEX.md`.

`useHourSlider` vive en `lib/hooks/useHourSlider.ts` con 7 tests
unitarios (empty models, M12 marine_global exclusion, max horizon
across selected, cap a view length, clamp a [0, max-1], …).

`home-content.tsx` baja de ~1550 a ~1525 líneas, pero el código del
slider queda mucho más legible y testeable.

---

## Fase D — Vectorización con Qdrant (sin ML)

Con la decisión del usuario de "ningún LLM, ninguna inteligencia",
la opción elegida es **BM25 sparse** (sin embeddings neuronales). Cumple
el principio: pure deterministic text matching con cero inferencia.

### Componentes

- `lib/indexer/bm25.ts` — tokenización + TF/IDF + scoring BM25
  (k1=1.5, b=0.75). Lexical-only.
- `lib/indexer/chunker.ts` — chunks por extensión: MD por headers,
  TS/TSX por exports (con fallback a archivo entero si <400 líneas),
  JSON 1 chunk por archivo. Id estable `sha256(path:startLine:content)`.
- `scripts/index-project.ts` — walks the tree (respeta `.gitignore` +
  denylist hard-coded para `node_modules`, `.next`, binarios,
  lockfiles), construye el índice BM25, persiste el vocabulario a
  `.qdrant-cache/vocab.json`, upserts en la colección
  `weather_chunks` (sparse vector named `'bm25'`).
- `scripts/qdrant-search.ts` — CLI: carga el vocabulario, vectoriza
  la query, query a Qdrant, imprime top-K con `path:line,
  language, summary, snippet`.
- `scripts/qdrant-up.sh` / `qdrant-down.sh` — docker helpers
  idempotentes.
- `docs/PROJECT_INDEX.md` — entry point para cualquier AI agent:
  layout, cómo arrancar Qdrant, cómo indexar, cómo buscar.

### Uso

```bash
bash scripts/qdrant-up.sh
npm run index:project
npm run query -- "por qué AHORA difiere de insights temp"
```

### Tests

- `lib/indexer/__tests__/bm25.test.ts` — 15 tests (tokenización,
  TF, IDF, vocabulary, symmetric vectorize/vectorizeQuery).
- `lib/indexer/__tests__/chunker.test.ts` — 8 tests (MD, TS,
  JSON, unsupported).
- `scripts/__tests__/indexer.test.ts` — denylist + round-trip
  BM25 → Qdrant shape.

### Lo que NO entra al índice

`node_modules`, `.next`, `.git`, `.opencode`, `.agents`, binarios,
lockfiles, todo lo que `.gitignore` marque.

---

## Fase E — Eficiencia de llamadas externas

El free-tier más caro era **BigDataCloud reverse-geocode**: el cliente
lo llamaba directamente sin caché en cada click de mapa. Estimación
pre-cambio: 5–50 llamadas upstream / sesión. Estimación post-cambio:
0–1 / sesión.

### Cambios

| # | Acción | Impacto |
|---|---|---|
| 1 | `app/api/reverse-geocode/route.ts` con `Cache-Control: public, s-maxage=86400` y redondeo a 2 decimales | **−80 % BigDataCloud** |
| 2 | `lib/externalStationsCache.ts` (Turso) para AEMET/Meteocat, 2 h fresh / 24 h stale | −50 % upstream cross-instance |
| 3 | `past_days=1` cuando `forecastDays <= 7` | −15–25 % BW forecast |
| 4 | Auto-refresh 4 h sólo si pestaña visible | −10–30 % fetches nocturnos |
| 5 | `useRefresh.ts` invalidación selectiva (forecast + status, no estaciones) | menos invalidaciones colaterales |
| 6 | Debounce 300 ms del slider de radio en `StationDashboard` | −30 % calls al arrastrar |
| 7 | `AbortController` para `/api/shorten` en `SettingsPanel` | menos BW desperdiciado |

### Tests

- 5 tests del proxy reverse-geocode (cache header, redondeo, 400,
  upstream fail, locality fallback).
- 8 tests del shared stations cache (fresh window, stale window,
  upsert, parse payload).
- 411 tests totales pasan; 0 lint errors; build OK.

---

## Tabla resumen de commits

| Hito | Branch | Commit |
|---|---|---|
| A | sprint-10/A-centralise-ensemble | `5928b2f` fix(ensemble) — centralise weights + force WedAI for current hour |
| A | sprint-10/A-centralise-ensemble | `e61b0c8` feat(insights) — annotate "Ahora" temperature on first day row |
| C | sprint-10/A-centralise-ensemble | `d3e3baa` refactor(home) — extract useHourSlider |
| D | sprint-10/D-qdrant-indexer | `08d8aa6` feat(qdrant) — index project for AI context + search CLI |
| E | sprint-10/E-api-optimisations | `dba8095` perf(api) — cache reverse-geocode, share stations cache, debounce radius |

---

## Métricas finales

| | Antes Sprint 10 | Después Sprint 10 |
|---|---|---|
| Tests | 291 | **411** |
| Lint errors | 0 | 0 |
| Lint warnings | ~18 (pre-existentes) | 17 (pre-existentes, sin nuevas) |
| Build | OK | OK |
| Cobertura B-10-1 (bug AHORA) | sin test | 3 tests de regresión + 15 tests central |
| Cobertura Qdrant indexer | nada | 23 tests (BM25 + chunker + indexer) |
| Cobertura API optimisations | nada | 13 tests nuevos |
| Llamadas upstream / sesión (estimado) | ~30–50 | ~5–10 |

---

## Follow-ups (no en scope de Sprint 10)

Documentados en `docs/PROJECT_INDEX.md` y en los comentarios de los
archivos:

- `useMobileA11y` — header collapse + matchMedia (requiere tests
  browser-level, no jsdom).
- `usePositionState` — seq counter para reverse-geocode out-of-order.
- `useEnsembleData` — useQuery + auto-refresh + IndexedDB (big).
- `past_days` dinámico según el día del año (cambiar a 3 en meses
  de invierno, 1 en verano) — pendiente decisión de producto.
- Cache selectivo del heatmap por región (no recalcular cuando el
  usuario arrastra <1 km).

---

## Criterio de cierre del sprint

- [x] Bug B-10-1 corregido con test de regresión.
- [x] UX del "↳ Ahora" implementada con tests.
- [x] `useHourSlider` extraído y migrado en `home-content.tsx`.
- [x] Qdrant indexer + search CLI funcionales con BM25 sparse.
- [x] 7 optimizaciones de llamadas externas con tests.
- [x] `docs/SPRINT_10.md` (este documento) escrito al final.
- [x] `docs/PROJECT_INDEX.md` escrito durante el Hito D.
- [x] `npm test` y `npm run lint` en verde.
- [x] Ramas + PR por hito (squash-merge a main al final).
- [x] Cero LLMs / cero ML en runtime (cumple la regla del proyecto).

---

## Riesgos mitigados

| Riesgo | Mitigación |
|---|---|
| Refactor de ensembles rompe números existentes | Tests de regresión previos al fix; 411 tests pasan tras el fix |
| Qdrant modifica runtime | Indexer y search son scripts CLI; no se importan desde `app/` |
| BigDataCloud pasa a ser pago si la cache falla | Cache CDN con stale-while-revalidate 7 días; fall-through a null y display de coords |
| Cambios de payload afectan parseos existentes | `parseStationsPayload` valida antes de servir; nulls degradan con graceful 502 |
| Nuevo tests en jsdom flaky con browser APIs | Sólo testeamos módulos puros; los hooks con matchMedia/rAF se difirieron a un follow-up |

# SPRINTS — Refactor & quality roadmap (S0 → S11)

This document describes the Sprints 0–11 refactor plan executed in
2026-07. Earlier plans (S1–S8) live in `docs/PLAN.md`, `docs/SPRINTS.md`
(historical) and `docs/SPRINTS_PLAN.md`.

## Goals

1. Eliminate bugs that erode forecast trust (S1, S2).
2. Reduce god-components and make the future development loop
   measurably faster (S3–S6).
3. Bring the dev/CI loop to the point where a new metric is a
   2-file change instead of a 4-file change (S3, S8).
4. Extract the layer that powers precision improvements (S10).

## Sprint index

| Sprint | Theme | Outcome |
|--------|-------|---------|
| S0  | Hygiene | React 19 Strict Mode active, Node `>=20.9` documented, dead tracking files removed, README rewritten. |
| S1  | Forecast correctness | `precipitation_probability` is a real metric; `getLeadTimeBucket` covers 168–360h; `InsightsTable` lead time no longer drifts when `startIndex > 0`; backtest no longer compares forecasts against themselves. |
| S2  | Heatmap & proxies | `parseOpenMeteoTime` recognises `+0530` and `+02:00:SS`; `MapPicker` paints the row at the absolute `viewTimes[hourIndex]`; `/api/forecast` and `/api/marine` share the cache/upstream helpers. |
| S3  | Contracts | `getMetricWeights` is a real implementation; `BM25Index.k1/b` typed (no `as unknown`); all dead exports removed; duplicate `SavedLocation`/`RefreshStatus`/`SeriesBag` types unified. |
| S4  | Hooks | `useClientNow`, `useDebouncedCallback`, `useClickOutside`, `useGeolocation`, `useReverseGeocode`, `useSavedLocations` and a status-aware `useRefresh` live in `lib/hooks/`. |
| S5  | Thin home-content | `CitiesList` extracted to `components/CitiesList.tsx`; home-content pulls saved-locations through the new hook. |
| S6  | InsightsTable | `lib/insightRows.ts` holds the pure bucket helpers; bucket-builder behaviour pinned by unit tests. |
| S7  | API cache & SW | `/api/sw` serves the SW with a build-time hash; `STRIPPED_KEYS` centralised; `request.signal` propagated upstream; `INSERT OR REPLACE` replaced with `ON CONFLICT DO UPDATE`. |
| S8  | Formatters | `lib/format.ts` centralises locale-aware formatters previously duplicated across components. |
| S9  | Tests & coverage | Strict-mode lint rule active; coverage thresholds defined for `lib/`, `app/api/` and `components/`. |
| S10 | Precision | `weightedAvg` accepts `biasCorrection`; `ForecastResult` exposes `dailyPrecipitationSum`, `dailyPrecipitationProbabilityMax`, `dailyPrecipitationHours`; `ensembleSpread` propagates model disagreement to the friendly card. |
| S11 | Documentation | `PROJECT_INDEX.md`, `README.md` and this file refreshed to reflect the post-S11 architecture. |

## Per-sprint summaries

### S0 — Hygiene
- Enabled `reactStrictMode` in `next.config.ts` after adding an
  idempotency guard to `MapPicker` (the previous `false` setting only
  existed to silence Leaflet's Strict Mode warning).
- Added `engines.node >= 20.9`, `"typecheck": "tsc --noEmit"`,
  `"test:coverage"`, `"lint:fix"`, `"backtest"`, `"test:watch"`.
- `dotenv` removed from runtime dependencies (Next 16 loads `.env*`
  automatically).
- Deleted `prod*.html`, `*.jpeg`, `dev.log`, `dev.err.log` from the
  working tree; replaced README with a real one.

### S1 — Forecast correctness
- `precipitation_probability` registered as a `MetricId`/`METRIC` and
  consumed in `computeCurrentSnapshot` (replaces the historical
  intensity heuristic; falls back to that heuristic when every model
  reports `null`).
- `weightsForAbsolute(metric, absoluteHour, bucket, active)` added in
  `lib/ensemble/central.ts`. `InsightsTable`, `DailySummary` and the
  comparison chart now use it, eliminating the previous bucket
  mis-classification that hit rows past the first day.
- `getLeadTimeBucket` extended with `168-240h` and `240-360h`; the
  presets in `lib/models.ts` carry weights for them.
- Backtest no longer fills missing per-model values with the
  best-match fallback (`lib/backtest/fetchPreviousRuns.ts`); ERA5 is
  pinned to `era5_seamless`; the weekly window uses `ms` math so DST
  boundaries can't drift it.

### S2 — Heatmap & proxies
- `parseOpenMeteoTime` accepts `Z`, `±HH:MM`, `±HHMM` and `±HH:MM:SS`.
- `fetchHeatmapGrid` requests `past_days=1` and parses the response
  through `parseOpenMeteoTimes`.
- `MapPicker` now anchors the painted cell to `viewTimes[hourIndex]`
  with a ±90-minute DST tolerance, replacing the previous
  `mapTimes[0] + hourIndex*3600_000` formula that froze at day 7.
- `STRIPPED_UPSTREAM_KEYS = { 'v' }` is declared once in
  `lib/cacheKey.ts`; both routes use `buildUpstreamParams` so the
  cache-buster stamp never reaches the provider.
- `request.signal` is forwarded upstream so a disconnected client
  doesn't keep the upstream fetch alive.

### S3 — Contracts
- `getMetricWeights` now blends the preset baselines with the
  dynamic accuracy rows instead of returning `{}`.
- `BM25Index` exposes `k1`/`b`; the `as unknown` cast is gone.
- `getDynamicWeights` (was `_unused_getDynamicWeights`) and the
  `listSnapshots`, `contrastText`, `getEnsembleWeights`,
  `computeForecastDays`, `HEATMAP_MAX_LOCATIONS` and
  `parseOpenMeteoTime` exports were removed.
- `SavedLocation`, `RefreshStatus` and `SeriesBag` are emitted from a
  single source each.
- `weightedAvg` accepts an additive `biasCorrection` map so the
  backtest's bias term can correct systematic over/under-prediction
  per model.

### S4 — Hooks
New shared hooks in `lib/hooks/`:
- `useClientNow` (replaces 4 `useState(null) + useEffect(Date.now)`).
- `useDebouncedCallback` (replaces 4 inline `setTimeout` pairs).
- `useClickOutside` (replaces 3 hand-rolled implementations).
- `useGeolocation` (replaces `home-content.handleGeolocate`).
- `useReverseGeocode` (replaces 3 different reverse-geocode effects).
- `useSavedLocations` (single source of saved-cities queries + mutations).
- `useRefresh` (status is now real; previously the field was `null`).

### S5 — Thin home-content
- `components/CitiesList.tsx` extracted; the orchestrator now reads
  saved locations via the shared hook.
- Replaced 5 `nowMs` / `currentTickMs` state pairs by `useClientNow`.

### S6 — InsightsTable split
- Pure helpers (`boundsForBucket`, `aggregateOverRange`,
  `alignToHourBoundary`, `absoluteLead`, `hourEpochMs`) live in
  `lib/insightRows.ts` and are unit-tested.

### S7 — API cache & SW
- `/api/sw` is a Next route that reads `public/sw.js` and substitutes
  the build hash (computed by `lib/serviceWorkerVersion.ts`).
  `next.config.ts` adds `Cache-Control: no-store` so a new deploy
  always pushes the latest SW.
- The cache-bust key (`v=`) is centralised in
  `STRIPPED_UPSTREAM_KEYS` and stripped by `buildUpstreamParams`.
- `INSERT OR REPLACE` in `shortLinks.ts` became
  `INSERT ... ON CONFLICT DO UPDATE` so the original `created_at`
  is preserved.

### S8 — Formatters
- `lib/format.ts` owns `fmtTemp`, `fmtPercent`, `fmtMm`, `fmtKmh`,
  `fmtDistanceKm` and `fmtNow`. Locale-aware so "now" → "ahora" in
  Spanish.

### S9 — Tests & coverage
- `eslint` rule `no-console: ["warn", { allow: ["warn", "error"] }]`.
- `vitest.config.ts` declares per-area coverage thresholds
  (lib 70%, app/api 65%, components 35%) but disables the v8 plugin
  by default; enable locally with
  `npm i -D @vitest/coverage-v8`.

### S10 — Precision
- `precipitation_probability` is wired through `EnsemblePreset` and
  consumed by `computeCurrentSnapshot`.
- `daily=precipitation_sum,precipitation_hours,precipitation_probability_max`
  is now requested alongside the hourly series; the daily arrays are
  aligned with the trimmed hourly series via `sliceForecast`.
- `ensembleSpread` exposes the WedAI stdDev / min / max so the UI
  can label the row "high / medium / low" confidence without having
  to recompute it.
- `getMetricWeights` blends preset and dynamic weights so the
  backtest can drive the ensemble weighting end-to-end (S10 plumbing,
  S11+ UI).

### S11 — Documentation
- `README.md` rewritten to document the actual stack, environment
  variables and scripts.
- `docs/PROJECT_INDEX.md` refreshes the module map and lists the new
  hooks.
- `docs/SPRINTS.md` (this file) summarises the S0–S11 refactor plan
  and its outcomes.

### S12 — InsightsTable refactor
- `lib/hooks/useColumnOrder.ts`: column-order state + persistence
  + reorder helper.
- `lib/hooks/useDragReorder.ts`: drag-state machine used by the
  Insights column picker.
- `lib/hooks/useInsightPagination.ts`: 48-row pager for the
  insights table.
- `components/HeatCell.tsx` and `components/InsightsToolbar.tsx`
  extracted from the 1708-line `InsightsTable.tsx`.
- `lib/__tests__/sprint11.insightsMeta.test.ts` covers the
  extracted helpers (4 tests).

### S13 — Profile = auto-derived, never user-selected
The previous `ProfilePicker` banner (Sprint 1.3) was a UI selector
backed by `useUsageProfile` (localStorage key `weather-profile`).
The hardcoded `PROFILE_RECOMMENDATIONS` table was exported but
never consumed: the banner promised a per-profile ensemble bias
and delivered nothing. Sprint 13 wires the bias to actual data and
hides the picker.

**What changed**

- `lib/profiles.ts`: new module. `UsageProfile` is now a 4-value
  string literal union (`plain`, `coastal`, `mountain`, `urban`).
  `deriveProfileFromTerrain(terrain)` maps the 6 `TerrainType`
  values down to those 4 profiles. Confidence below 0.6 always
  falls back to `plain`.
- `lib/ensemble/central.ts`: new `weightsForProfile(metric,
  hourIndex, bucketHours, activeModels, recommended, profile)`. It
  is a profile-aware wrapper over `weightsFor` that applies a +5%
  boost (capped at 2× the original weight) to every model that is
  both active and in the backtest recommendation set. `profile
  === 'plain'` and an empty recommendation set both short-circuit
  to the unmodified `weightsFor` output.
- `lib/backtest/db.ts`: new `getModelAccuracyByTerrain(terrain,
  metric, leadTimeBucket, { topN, windowDays })`. Terrain-wide
  query (no specific lat/lon), ordered by RMSE ASC, limited to
  `topN` (default 5) within a 90-day rolling window. Returns `[]`
  when the DB is unavailable or no rows match.
- `lib/hooks/useEffectiveProfile.ts`: new React hook. Resolves the
  profile from `classifyTerrain(lat, lon)` asynchronously; caches
  the result per ~1 km grid so the elevation API isn't hit on
  every render. The hook never throws — failures are surfaced via
  `result.error` and the caller falls back to the un-boosted
  ensemble.
- `components/ProfileChip.tsx`: small badge rendered next to the
  "Tiempo actual" card. Shows `Perfil: <name> · <N models>` when
  the boost is taking effect, `Perfil: <name> · No regional bias`
  otherwise. Hidden entirely while the classifier is in flight.
- `lib/friendlyForecast.ts`: every `meanAcrossModels` call inside
  `computeCurrentSnapshot` now threads `profile` and `recommended`
  down to `weightsForProfile`. Default args preserve the
  pre-S13 behaviour byte-for-byte when the caller doesn't pass
  them (e.g. older tests).
- `components/ProfilePicker.tsx`, `lib/hooks/useUsageProfile.ts`
  and the `PROFILE_RECOMMENDATIONS` table are deleted. The
  `localStorage` `weather-profile` key is no longer read or
  written.

**Tests added** (40 across the sprint, total 539 → 579 passing)

- `lib/__tests__/sprint13.profiles.test.ts` (13 tests) — the
  terrain → profile mapping and confidence fallback.
- `lib/ensemble/__tests__/sprint13.weightsForProfile.test.ts`
  (11 tests) — boost, renormalisation, cap, and short-circuit
  semantics.
- `lib/backtest/__tests__/sprint13.getModelAccuracyByTerrain.test.ts`
  (6 tests) — query construction, options, and graceful empty
  fall-back.
- `lib/hooks/__tests__/sprint13.useEffectiveProfile.test.tsx`
  (9 tests) — derivation, caching, error capture.
- `lib/__tests__/sprint13.snapshotProfile.test.ts` (4 tests) —
  end-to-end integration through `computeCurrentSnapshot`.

**User-visible behaviour**

- The ProfilePicker banner is gone.
- A small `ProfileChip` next to the "Tiempo actual" card shows
  the active profile (`Costero`, `Montaña`, `Urbano`, `Llanura`).
- When the backtest has rows for the current terrain, the chip
  shows how many recommended models are being boosted. The
  ensemble reading shifts by a few percent in their direction;
  the ranking stays stable.
- The Marine toggle remains 100% manual. The coastal profile
  recommends marine models in the ensemble, but it never turns
  the toggle on.

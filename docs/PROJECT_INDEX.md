# PROJECT_INDEX.md — Project context for AI agents

This repository is a Next.js 16 / React 19 weather comparison app. It
fetches forecasts from multiple meteorological models, lets the user
compare them side-by-side and cross-reference them with live station
observations from AEMET, Meteocat and Meteoclimatic.

This file is the entry point for any AI agent (Claude, GPT, …) that
needs a quick map of the project without having to grep the whole tree.

---

## 1 · High-level layout

```
app/              Next.js App Router (page, layout, providers, API routes)
  api/sw/         Service Worker served with the build-stamped version
components/       React UI (27 components, no external UI library)
lib/              Pure logic (models, ensemble, forecasts, date utils)
  ensemble/       Centralised ensemble logic (meanAtHour, weightsFor…)
  hooks/          Extracted hooks (useHourSlider, useGeolocation, …)
  backtest/       Backtesting scripts against ERA5 reanalysis
  indexer/        BM25 + chunker used by the Qdrant indexer
docs/             Human-readable documentation (CONVENCIONES, SPRINT_*)
scripts/          Build / index / backtest helpers
e2e/              Playwright end-to-end tests
```

The schema, conventions and sprint history live in `docs/`:
- `docs/CONVENCIONES.md` — code conventions, naming, tokens
- `docs/ESQUEMA_DATOS.md` — DB schema + URL state shape
- `docs/SPRINT_*.md` — per-sprint history (Sprint 0 … Sprint 14)

---

## 2 · How to get oriented quickly

When answering questions about the code, prefer:

1. **The central ensemble module** (`lib/ensemble/central.ts`) — single
   source of truth for "what's the weighted temperature at hour H".
   `resolveActiveModels`, `weightsFor`, `meanAtHour`, `meanOverBucket`.
2. **The friendly forecast module** (`lib/friendlyForecast.ts`) —
   builds the `CurrentSnapshot` and the hourly slots used by the
   `FriendlyHome` view.
3. **The InsightsTable component** (`components/InsightsTable.tsx`)
   — renders the per-day/per-hour table; consumes the central module.
4. **The home page** (`app/home-content.tsx`) — composition root;
   the bulk of the state lives here.

For URL-driven state: `lib/useUrlState.ts` — every query parameter is
documented in `docs/ESQUEMA_DATOS.md`.

For external APIs: each external integration has its own module under
`lib/` (`lib/openMeteo.ts`, `lib/aemet.ts`, `lib/meteocat.ts`,
`lib/meteoclimatic.ts`, `lib/reverseGeocode.ts`)
and a corresponding server route under `app/api/`.

---

## 3 · Project-context index (Qdrant)

This repo ships with a local Qdrant index to make the codebase
queryable by lexical search (BM25, no ML). The index is intentionally
sparse-only and produces deterministic, fully offline-friendly vectors.

### 3.1 · Start Qdrant (one-time, local only)

```bash
bash scripts/qdrant-up.sh
# Wait for "ready at http://localhost:6333"
```

If Docker isn't available, run Qdrant another way:

```bash
docker run -d --name qdrant -p 6333:6333 -p 6334:6334 \
  -v qdrant_storage:/qdrant/storage qdrant/qdrant:latest
```

### 3.2 · Index the project

```bash
npm run index:project
```

This walks the tree, chunks each file with `lib/indexer/chunker.ts`,
vectorises with `lib/indexer/bm25.ts` and upserts into the
`weather_chunks` collection. The BM25 vocabulary is persisted to
`.qdrant-cache/vocab.json` so the search CLI uses the same vocabulary.

Dry-run (skip Qdrant):

```bash
WEATHER_INDEX_DRY_RUN=1 npm run index:project
```

### 3.3 · Search

```bash
npm run query -- "por qué AHORA difiere de insights temp"
npm run query -- "computeCurrentSnapshot WedAI"
npm run query -- "ENSEMBLE_PRESETS"
```

Output format:

```
67.9673  lib/__tests__/centralEnsemble.test.ts:1-176  (typescript)
  /** * Regression test for B-10-1: * "en mobile, la temperatura que se muestra en ...
```

Top K is configurable: `QDRANT_TOP_K=20 npm run query -- "..."`.

### 3.4 · Idempotency

Chunk ids are `sha256(path:startLine:content)[:16]`. Re-running
`npm run index:project` with no changes is a no-op (Qdrant upserts the
same point ids).

### 3.5 · What is NOT indexed

- `node_modules`, `.next`, `.git`, `.opencode`, `.agents`, `coverage`,
  `dist`, `build`, `.qdrant-cache`.
- Binary files (PNG, JPG, …).
- `package-lock.json`, `tsconfig.tsbuildinfo`.
- Anything matched by `.gitignore` (the indexer parses it).

### 3.6 · Re-create the Qdrant container

```bash
bash scripts/qdrant-down.sh
docker volume rm qdrant_storage
bash scripts/qdrant-up.sh
npm run index:project
```

---

## 4 · Conventions cheat sheet

- **Language:** code identifiers in English; UI bilingual (es/en, es
  default); docs in es-ES.
- **DB naming:** snake_case, plural for collections, `*_at` for timestamps.
- **State naming:** URL params kebab-case (`lat`, `lon`, `bucket`, …);
  camelCase in code.
- **Commit format:** `<tipo>(<alcance>): <descripción>` (see CONVENCIONES §7).
- **Hooks:** `useXxx` prefix; pure derivation hooks live in `lib/hooks/`.
- **No LLM, no inference, no embeddings in production runtime.** The
  Qdrant indexer uses BM25 (sparse vectors) which is pure deterministic
  text matching with no neural model.

---

## 5 · Common tasks

| Task | Where |
|------|-------|
| Change the forecast URL params | `app/api/forecast/route.ts` |
| Add a new model | `lib/models.ts` (and update ENSEMBLE_PRESETS) |
| Add a new station source | new `lib/<source>.ts` + `app/api/<source>/route.ts` |
| Change the InsightsTable columns | `components/InsightsTable.tsx` |
| Add a new i18n string | `lib/i18n.ts` |
| Change a token / colour | `app/globals.css` (`@theme inline`) |

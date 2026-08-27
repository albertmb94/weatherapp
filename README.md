# Weather — model ensemble & station dashboard

A bilingual (es / en) Next.js 16 dashboard that pulls forecasts from many
meteorological models, blends them into a calibrated ensemble and lets the
user cross-reference the result with live ground stations (AEMET, Meteocat,
Meteoclimatic).

- **Frameworks**: Next.js 16 (App Router) + React 19 + TanStack Query 5.
- **Maps**: Leaflet 1.9 via react-leaflet 5 (client-only).
- **Charts**: Recharts 3.
- **Database**: libSQL locally (`local.db`), Turso in production.
- **Styling**: Tailwind v4 with `@theme inline` design tokens.
- **Service worker**: registered from `app/layout.tsx`.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest run
npm run e2e          # playwright (chromium only)
```

## Environment

`.env.local` (gitignored). All keys are optional — the app degrades gracefully
when external sources are not configured.

| Variable | Purpose |
|---|---|
| `TURSO_DATABASE_URL` | libSQL connection string. Falls back to `file:local.db` in dev. |
| `TURSO_AUTH_TOKEN` | Token for the Turso instance above. |
| `AEMET_API_KEY` | AEMET open-data API key (JWT). Without it, the Stations tab hides AEMET but Meteoclimatic + Meteocat keep working. |
| `METEOCAT_API_KEY` | Meteocat XEMA network token. Same graceful degradation. |
| `SENTRY_DSN` | Optional; `@sentry/nextjs` is loaded only when set. |
| `ADMIN_EMAIL` | First superadmin for the `/admin` panel. Read once at boot — redeploy to change. See `docs/ADMIN.md`. |
| `NEXT_PUBLIC_APP_URL` | Public URL used for magic links in emails. |
| `RESEND_API_KEY` | Transactional email sender. Without it, admin magic links print to Vercel logs. |
| `EMAIL_FROM` | From-address for transactional emails (see `lib/emails.ts`). |
| `BACKTEST_SECRET` | Bearer token protecting `/api/backtest` (503 without it). |
| `STRIPE_SECRET_KEY` | Placeholder for the future direct Stripe integration — the live checkout configuration lives in `/admin/features` (`feature_flags.config`). |

A reference `.env.example` ships in the repo. **Admin & monetization env vars** are documented in `.env.example` under the `=== Admin / Monetization ===` section.

## Admin panel

The app ships an `/admin` panel where every monetization feature can be toggled without redeploy. See `docs/ADMIN.md` for the full setup, including the magical-link flow, the feature catalogue, and how to enable Premium / Stations / Affiliates / Ads / Newsletter / Push / Donations.

## Architecture

```
app/              App Router (page, layout, providers, /api routes)
components/       React UI (no external component lib)
lib/              Pure logic (models, ensemble, forecasts, date utils)
  ensemble/       Centralised calibrated weights, meanAtHour, meanOverBucket
  hooks/          Cross-cutting hooks (useHourSlider, useNearbyStations, …)
  indexer/        BM25 + chunker for the offline Qdrant indexer
  backtest/       Weekly ERA5 verification + Borda weight calibration
docs/             Conventions, schema, sprint history, sprint legend
scripts/          Build / index / backtest / calibrate helpers
e2e/              Playwright specs
```

State of truth: URL state (`lib/useUrlState.ts`). The only persistent
client state is per-city preferences in `localStorage`. Server caches
live in Turso (`forecast_cache`, `marine_cache`, `short_links`,
`app_state`).

The full architecture, conventions and sprint history live in
`docs/`. Start with `docs/PROJECT_INDEX.md`.

## Deploy

This app is designed to deploy on Vercel:

1. Push the repository to a Git remote.
2. Import the project in Vercel.
3. Add the env vars listed above (or leave them empty for graceful
   degradation).
4. Deploy. The first deploy provisions the Turso DB and the rate-limited
   `/api/*` routes via edge cron.

External station keys have monthly quotas — see `docs/ESQUEMA_DATOS.md`
for cache TTLs.

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
| `SENTRY_DSN` | Optional; `@sentry/nextjs` is loaded only when set (and must be installed). |
| `ADMIN_EMAIL` | Owner superadmin seeded into `admin_users`. See `docs/ADMIN.md`. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Seed the initial `admin_credentials` row (only when the table is empty). No seed is created without `ADMIN_PASSWORD`. |
| `NEXT_PUBLIC_APP_URL` | Canonical public URL for Stripe redirects, claim links and emails. |
| `RESEND_API_KEY` | Transactional email sender (fallback when `feature.resend.api_key` is unset). |
| `EMAIL_FROM` | From-address for transactional emails (see `lib/emails.ts`). |
| `CRON_SECRET` | Bearer token protecting `/api/cron/analytics-rollup` (Vercel cron). |
| `BACKTEST_SECRET` | Bearer token protecting `/api/backtest` (503 without it). |
| `DB_ALLOW_FILE_IN_PRODUCTION` | Self-hosted over HTTP: allow non-Secure admin cookies. |
| `BACKTEST_DB_URL` | Tooling only (`scripts/calibrateEnsemble.ts`); defaults to `file:local.db`. |

Stripe keys and prices are managed in `/admin/features` (`feature_flags.config`)
and `/admin/plans` — the `STRIPE_*` / `VAPID_*` env vars are placeholders for a
future direct integration and are not read at runtime.

A reference `.env.example` ships in the repo. **Admin & monetization env vars**
are documented in `.env.example` under the `=== Admin / Monetization ===`
section. **Never commit real credentials** to `.env.example`.

## Admin panel

The app ships an `/admin` panel where every monetization feature can be toggled without redeploy. See `docs/ADMIN.md` for the full setup, including the login flow (username/password), the feature catalogue, and how to enable Premium / Stations / Affiliates / Ads / Newsletter / Push / Donations.

## Languages and URLs

The site is bilingual (Spanish / English) and the language lives **in the
route**, not in localStorage. Spanish is the default and carries **no
prefix**, so every URL that existed before the i18n refactor still works
unchanged — shared links, short links, Stripe return URLs and the
`page_views` history all stay valid.

| | Spanish (default) | English |
|---|---|---|
| Home | `/` | `/en` |
| Premium | `/premium` | `/en/premium` |
| Cookie policy | `/cookies` | `/en/cookies` |

- `/es/...` is accepted but **308-redirects** to the unprefixed form, so
  each page has exactly one canonical URL per language.
- Every page emits its own `canonical` plus `hreflang` alternates. These
  are per **page**, never on the layout: a layout canonical is inherited
  by all its children, which would make `/cookies` declare that it *is*
  the homepage.
- `<html lang>` is rendered **by the server**. `proxy.ts` resolves the
  language and passes it to the root layout in a request header, because
  the root layout sits above the `[locale]` segment and gets no params.
- A visitor with no stored choice is redirected by `Accept-Language`.
  **Bots never are**: Googlebot crawls with `Accept-Language: en`, so
  negotiating with it would serve it the English site and hide the
  Spanish one. It sees the default and finds the rest through `hreflang`.
- An explicit choice (the ES/EN toggle) is stored in the `wthr_locale`
  cookie and wins over `Accept-Language`.
- `/admin`, `/api/...` and `/s/...` are exempt: they never carry a
  language prefix. See `lib/locale/routing.ts`.

Switching language performs a **full navigation**, not a client-side
push: `<html lang>` comes from the root layout, which a client
navigation does not re-render.

## Architecture

```
app/              App Router
app/[locale]/     public pages (home, premium, legal) — bilingual
app/admin/        admin panel (Spanish only, no locale prefix)
app/api/          route handlers
components/       React UI (no external component lib)
lib/              Pure logic (models, ensemble, forecasts, date utils)
  locale/         URL scheme per language (routing, page metadata)
  analytics/      Client tracker, session rotation, Madrid day keys
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

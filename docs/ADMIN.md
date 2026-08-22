# Admin & Monetization

The `/admin` panel is the single source of truth for every monetization feature. Each feature is gated by a row in the `feature_flags` table and can be enabled/disabled without a redeploy.

## Vercel + Turso deployment requirements

These env vars **must** be present in Vercel for the admin to work:

| Variable | Required | Notes |
|---|---|---|
| `TURSO_DATABASE_URL` | ✅ | `libsql://your-db.turso.io` |
| `TURSO_AUTH_TOKEN` | ✅ | Turso token |
| `ADMIN_EMAIL` | ✅ | First superadmin. Read once at boot → redeploy to change. |
| `NEXT_PUBLIC_APP_URL` | recommended | Used to build magic-link URLs in emails. Defaults to `req.nextUrl.origin`. |
| `APP_URL` | optional | Fallback for `NEXT_PUBLIC_APP_URL`. |
| `RESEND_API_KEY` | optional | Without it, magic links are printed to Vercel logs. |
| `EMAIL_FROM` | optional | Required for transactional emails. Defaults to `Weather <hello@example.com>`. |
| `STRIPE_SECRET_KEY` | optional | Required for Premium/Stations checkout. |
| `STRIPE_WEBHOOK_SECRET` | optional | Required for webhook signature verification. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | optional | Required for client-side Stripe Elements. |

## Architecture

```
Browser ── proxy.ts (Edge) ──> App routes (Node.js)
                    │                │
                    │                ├─> Admin pages (/admin/*)
                    │                │     └─> lib/admin/auth.ts (DB session check)
                    │                │
                    │                ├─> /api/admin/* (magic link, features, etc.)
                    │                │
                    │                └─> /api/track/* (fire-and-forget pageviews)
                    │
                    └─> Sets anon-id + session-id cookies on every request
```

## Boot sequence

1. **First request to any admin route** → `lib/admin/auth.ts` ensures `admin_users` + `admin_sessions` tables exist, seeds `ADMIN_EMAIL` as superadmin.
2. **First request to `/premium` or `/admin/plans`** → `lib/plans.ts` seeds the three default plans (Premium, Stations, Bundle) with `enabled=0`.
3. **First request to `/admin/emails`** → `lib/emails.ts` seeds the four default templates (welcome, cross-sell, newsletter confirm, receipt).
4. **First request to `/api/features/[key]`** for any known key → `lib/features.ts` seeds the catalogue row (enabled=0).
5. **First request to `/api/track/pageview`** → `lib/affiliate.ts` (or the route itself) creates `page_views` + `sessions`.
6. **First request to `/api/affiliate/redirect`** → `lib/affiliate.ts` creates `affiliate_products` + `affiliate_clicks`.

All the above use `CREATE TABLE IF NOT EXISTS` so the schema is idempotent and safe to re-run.

## Magic-link auth flow

1. User goes to `/admin/login`, enters email.
2. `POST /api/admin/auth/request`:
   - Per-IP rate limit (5/min).
   - Validates email is in `admin_users`.
   - Inserts a `kind='magic_link'` row in `admin_sessions` (TTL 7 days).
   - Sends email via Resend (if enabled) or logs to console.
3. User clicks the link → `GET /api/admin/auth/verify?token=...`:
   - `consumeMagicLink` deletes the magic-link row (one-time use).
   - Creates a fresh `kind='session'` row.
   - Sets `wthr_admin` cookie with the new token.
4. Admin `(authenticated)/layout.tsx` calls `getCurrentAdmin()` — `React.cache` memoises the look-up so multiple server components share one DB query.

To get the magic link in Vercel without Resend configured, filter logs for:
```
[admin] magic link | email=... | url=https://... | resend=skipped
```

## Feature flags

All features default to OFF. The admin enables them via `/admin/features`. Each flag has a `config` JSON field for runtime configuration (API keys, slot IDs, etc.).

| Key | Purpose |
|---|---|
| `feature.cookiebot` | GDPR consent banner. |
| `feature.plausible` | Plausible analytics. |
| `feature.resend` | Transactional email sender. |
| `feature.stripe` | Payment processor. |
| `feature.premium_checkout` | Show Premium checkout button. |
| `feature.stations_checkout` | Show Stations add-on checkout. |
| `feature.affiliates` | Sponsored sections. |
| `feature.affiliates.amazon` | Amazon Associates provider. |
| `feature.ads.adsense` | Google AdSense. |
| `feature.ads.ethicalads` | EthicalAds. |
| `feature.newsletter` | Newsletter signup. |
| `feature.buttondown` | Buttondown provider. |
| `feature.push` | Web Push. |
| `feature.kofi` | Ko-fi donate button. |
| `feature.githubsponsors` | GitHub Sponsors. |
| `feature.metrics_dashboard` | Show `/admin/metrics`. |
| `feature.feature_flags_admin` | Show `/admin/features` (always on). |
| `feature.anomaly_alerts` | Daily anomaly detection cron. |

## Performance notes

- `getFeature` uses React `cache` so multiple consumers in the same render share one DB query. **Cross-request caching is not implemented** — every page load triggers 2 DB queries (`feature.cookiebot` + `feature.plausible`) on the root layout. For high-traffic deploys, lift these to `unstable_cache` with a 60s TTL.
- `proxy.ts` fires a `fetch` to `/api/track/pageview` on every request. The fetch is `keepalive: true` so it doesn't block response flushing. For very high traffic, batch these writes.
- Magic links are one-time use (deleted on first verify). TTL is 7 days. Sessions are persistent (TTL 7 days, sliding — the cookie is re-issued on every validate).

## Security

- `proxy.ts` adds baseline security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production).
- Admin cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production.
- Magic-link tokens are 32 random bytes (`crypto.getRandomValues` in Edge runtime, `randomBytes(32)` in Node).
- Affiliate redirect enforces an allowlist of marketplaces (Amazon domains, Awin, Booking).
- Admin endpoints are rate-limited per IP (auth: 5/min) and per admin (campaigns: 12/5min).

## Not yet implemented (stretch)

- Stripe SDK not installed. Checkouts return `503 stripe_sdk_pending` until `npm install stripe` and the integration block is uncommented.
- Web Push not installed. The push handlers will be added when `feature.push` is enabled.
- Vercel cron runs need to be set up in `vercel.json` (not present yet). The cron endpoints all live under `/api/cron/*` and accept a bearer token.
- Cross-request caching for `getFeature` (mentioned above).
- Cohorts, funnels, and anomaly detection — the dashboard stubs are in place but the analytics queries are not built.

## Local development

```bash
npm install
npm run dev
# Visit http://localhost:3000/admin/login
# The first magic link will be printed to the dev server console.
```

For local dev with the full Stack:
```bash
# Add to .env.local:
ADMIN_EMAIL=you@example.com
TURSO_DATABASE_URL=file:./local.db
TURSO_AUTH_TOKEN=    # empty for local SQLite
APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

The dev server uses `file:local.db` (SQLite) when `TURSO_DATABASE_URL` is empty. Prod uses Turso automatically.

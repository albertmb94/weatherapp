# Admin & Monetization

The `/admin` panel is the single source of truth for every monetization feature. Each feature is gated by a row in the `feature_flags` table and can be enabled/disabled without a redeploy.

## Vercel + Turso deployment requirements

These env vars **must** be present in Vercel for the admin to work:

| Variable | Required | Notes |
|---|---|---|
| `TURSO_DATABASE_URL` | âœ… | `libsql://your-db.turso.io` |
| `TURSO_AUTH_TOKEN` | âœ… | Turso token |
| `ADMIN_EMAIL` | âœ… | First superadmin. Read once at boot â†’ redeploy to change. |
| `NEXT_PUBLIC_APP_URL` | optional | Base URL for Stripe success/cancel redirects. Defaults to request origin. |
| `APP_URL` | optional | Fallback for `NEXT_PUBLIC_APP_URL`. |
| `RESEND_API_KEY` | optional | Transactional email sender. |
| `EMAIL_FROM` | optional | Required for transactional emails. Defaults to `Weather <hello@example.com>`. |
| `STRIPE_SECRET_KEY` | optional | Required for Premium/Stations checkout. |
| `STRIPE_WEBHOOK_SECRET` | optional | Required for webhook signature verification. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | optional | Required for client-side Stripe Elements. |

## Architecture

```
Browser â”€â”€ proxy.ts (Edge) â”€â”€> App routes (Node.js)
                    â”‚                â”‚
                    â”‚                â”œâ”€> Admin pages (/admin/*)
                    â”‚                â”‚     â””â”€> lib/admin/auth.ts (DB session check)
                    â”‚                â”‚
                    â”‚                â”œâ”€> /api/admin/* (login, features, etc.)
                    â”‚                â”‚
                    â”‚                â””â”€> /api/track/* (fire-and-forget pageviews)
                    â”‚
                    â””â”€> Sets anon-id + session-id cookies on every request
```

## Boot sequence

1. **First request to any admin route** â†’ `lib/admin/auth.ts` ensures `admin_users` + `admin_sessions` tables exist, seeds `ADMIN_EMAIL` as superadmin.
2. **First request to `/premium` or `/admin/plans`** â†’ `lib/plans.ts` seeds the three default plans (Premium, Stations, Bundle) with `enabled=0`.
3. **First request to `/admin/emails`** â†’ `lib/emails.ts` seeds the four default templates (welcome, cross-sell, newsletter confirm, receipt).
4. **First request to `/api/features/[key]`** for any known key â†’ `lib/features.ts` seeds the catalogue row (enabled=0).
5. **First request to `/api/track/pageview`** â†’ `lib/affiliate.ts` (or the route itself) creates `page_views` + `sessions`.
6. **First request to `/api/affiliate/redirect`** â†’ `lib/affiliate.ts` creates `affiliate_products` + `affiliate_clicks`.

All the above use `CREATE TABLE IF NOT EXISTS` so the schema is idempotent and safe to re-run.

## Acceso: usuario y contraseña (B-NBT-11)

El magic link está DESACTIVADO. El acceso es clásico:

1. Define en el entorno (antes del primer arranque):
   - `ADMIN_EMAIL` — identidad del owner en `admin_users`.
   - Opcional: `ADMIN_USERNAME` (default `admin`) y `ADMIN_PASSWORD`
     para personalizar las credenciales sembradas.
2. Si la tabla `admin_credentials` está vacía, el primer arranque siembra:
   - usuario `admin` · contraseña `Wx-Staging-2026!k7Q` (cámbiala).
3. Entra en `/admin/login` con usuario y contraseña.
   - Errores genéricos (no revela si falló usuario o contraseña).
   - Rate limit 5 intentos/min/IP.

Rotar contraseña: UPDATE en `admin_credentials.password_hash`
(formato `s1$salt$hash`, scrypt) o borra la fila y reinicia para
re-sembrar desde `ADMIN_PASSWORD`.

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

- `getFeature` uses React `cache` so multiple consumers in the same render share one DB query. **Cross-request caching is not implemented** â€” every page load triggers 2 DB queries (`feature.cookiebot` + `feature.plausible`) on the root layout. For high-traffic deploys, lift these to `unstable_cache` with a 60s TTL.
- `proxy.ts` fires a `fetch` to `/api/track/pageview` on every request. The fetch is `keepalive: true` so it doesn't block response flushing. For very high traffic, batch these writes.
- Magic links are one-time use (deleted on first verify). TTL is 7 days. Sessions are persistent (TTL 7 days, sliding â€” the cookie is re-issued on every validate).

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
- Cohorts, funnels, and anomaly detection â€” the dashboard stubs are in place but the analytics queries are not built.

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

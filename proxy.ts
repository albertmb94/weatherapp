import { NextRequest, NextResponse } from 'next/server'

const ANON_COOKIE = 'wthr_anon'
const SESSION_COOKIE = 'wthr_session'
const SESSION_SEEN_COOKIE = 'wthr_session_seen'
const ADMIN_COOKIE = 'wthr_admin'

/**
 * Next.js 16 proxy.ts (formerly middleware.ts).
 *
 * Tracks anonymous users via two cookies (anon-id + session-id),
 * gates the /admin subtree, and bounces a fire-and-forget pageview
 * to /api/track/pageview for the analytics dashboard.
 *
 * Notes for the Vercel + Turso deployment:
 *
 * 1. Runs on the Edge runtime on Vercel — no Node.js APIs (no
 *    `crypto.randomBytes`, no `fs`, no `Buffer`). Use Web Crypto
 *    (`crypto.getRandomValues`) for random bytes.
 * 2. The `isAdmin` cookie check is *presence only*; actual session
 *    validation runs in the route handler (lib/admin/auth.ts) so
 *    the DB lookup stays in the Node.js runtime.
 * 3. The matcher excludes /api/track, /api/health, /api/features to
 *    avoid recursive pageview writes and double-tracking.
 * 4. The matcher also excludes /api/affiliate/redirect — we record
 *    the click in a dedicated table (/api/affiliate/redirect writes
 *    a row to affiliate_clicks) so the pageview tracker doesn't need
 *    to know about it.
 */

/** Match every request EXCEPT static assets, internal Next endpoints
 *  and the SW. We still want analytics + anon-id on every page. */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon-.*\\.svg|sw\\.js|api/track|api/health|api/features|api/affiliate/redirect).*)',
  ],
}

/** Edge-runtime-safe random byte generator. Uses Web Crypto
 *  `crypto.getRandomValues` which is available in the Edge runtime
 *  (Node's `crypto.randomBytes` is not). */
function randomBytes(size: number): Uint8Array {
  const arr = new Uint8Array(size)
  crypto.getRandomValues(arr)
  return arr
}

function toHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    s += (bytes[i] ?? 0).toString(16).padStart(2, '0')
  }
  return s
}

function parseAcceptLanguage(header: string | null): string | null {
  if (!header) return null
  // Pick the highest-q language code.
  const parts = header.split(',').map(p => {
    const [tag, q] = p.trim().split(';q=')
    return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 }
  })
  parts.sort((a, b) => b.q - a.q)
  const tag = parts[0]?.tag ?? ''
  return tag.split('-')[0].toUpperCase() || null
}

function parseDevice(ua: string): 'mobile' | 'tablet' | 'desktop' {
  const lc = ua.toLowerCase()
  if (/ipad|tablet|android(?!.*mobile)/.test(lc)) return 'tablet'
  if (/iphone|android.*mobile|mobile|blackberry|opera mini/.test(lc)) return 'mobile'
  return 'desktop'
}

function parseBrowser(ua: string): string {
  if (/edg\//.test(ua)) return 'Edge'
  if (/chrome\//.test(ua) && !/chromium/.test(ua)) return 'Chrome'
  if (/firefox\//.test(ua)) return 'Firefox'
  if (/safari\//.test(ua) && !/chrome/.test(ua)) return 'Safari'
  if (/opera|opr\//.test(ua)) return 'Opera'
  return 'Other'
}

function parseOS(ua: string): string {
  if (/windows/.test(ua)) return 'Windows'
  if (/iphone|ipad|ipod/.test(ua)) return 'iOS'
  if (/android/.test(ua)) return 'Android'
  if (/mac os/.test(ua)) return 'macOS'
  if (/linux/.test(ua)) return 'Linux'
  return 'Other'
}

/** Apply the project's baseline security headers to every response.
 *  Kept conservative so the existing weather app (which loads Leaflet,
 *  Open-Meteo, Plausible, etc.) keeps working. Tighten as the surface
 *  matures. */
function applySecurityHeaders(res: NextResponse): void {
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'SAMEORIGIN')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()')
  // HSTS only when terminating TLS (production). Vercel already enforces
  // HTTPS at the edge, but the header is harmless on http://localhost.
  if (process.env.NODE_ENV === 'production') {
    // The `includeSubDomains` flag is conservative; the existing app
    // doesn't serve any other subdomain.
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Admin gate (deferred to route handler when DB is needed; here we just
  // guard by cookie presence to keep middleware synchronous and fast).
  if (pathname.startsWith('/admin')) {
    const token = req.cookies.get(ADMIN_COOKIE)?.value
    const isLoginPage = pathname === '/admin/login' || pathname.startsWith('/admin/login/')
    if (!token && !isLoginPage) {
      const url = req.nextUrl.clone()
      url.pathname = '/admin/login'
      return NextResponse.redirect(url)
    }
    // If they have a token, the actual session validation happens in the
    // route handler (we can't await DB lookups here without breaking the
    // edge runtime contract).
  }

  // anon-id (2-year persistent cookie)
  let anonId = req.cookies.get(ANON_COOKIE)?.value
  let isNewAnon = false
  if (!anonId) {
    anonId = toHex(randomBytes(16))
    isNewAnon = true
  }

  // session-id (sliding 30-min window)
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value ?? toHex(randomBytes(12))
  const lastSeen = Number(req.cookies.get(SESSION_SEEN_COOKIE)?.value ?? '0')
  const isNewSession = !req.cookies.get(SESSION_COOKIE)?.value || Date.now() - lastSeen > 30 * 60 * 1000

  const ua = req.headers.get('user-agent') ?? ''
  const acceptLang = req.headers.get('accept-language') ?? ''
  const country = parseAcceptLanguage(acceptLang)
  const device = parseDevice(ua)
  const browser = parseBrowser(ua)
  const os = parseOS(ua)
  const referrer = req.headers.get('referer') ?? undefined
  const utm = {
    source: req.nextUrl.searchParams.get('utm_source') ?? undefined,
    medium: req.nextUrl.searchParams.get('utm_medium') ?? undefined,
    campaign: req.nextUrl.searchParams.get('utm_campaign') ?? undefined,
  }

  // Build response, attach cookies + headers
  const res = NextResponse.next()
  applySecurityHeaders(res)
  if (isNewAnon) {
    res.cookies.set(ANON_COOKIE, anonId, {
      maxAge: 60 * 60 * 24 * 730,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })
  }
  res.cookies.set(SESSION_COOKIE, sessionId, {
    maxAge: 60 * 60 * 24,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  res.cookies.set(SESSION_SEEN_COOKIE, String(Date.now()), {
    maxAge: 60 * 60 * 24,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  res.headers.set('x-anon-id', anonId)
  res.headers.set('x-session-id', sessionId)
  res.headers.set('x-is-new-session', isNewSession ? '1' : '0')

  // Fire-and-forget pageview tracking. The track endpoint is in the
  // matcher exclusion list above so this fetch doesn't recursively
  // hit the proxy.
  const fullPath = pathname + req.nextUrl.search
  const origin = req.nextUrl.origin
  void fetch(`${origin}/api/track/pageview`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-anon-id': anonId,
      'x-session-id': sessionId,
    },
    body: JSON.stringify({
      path: fullPath,
      referrer,
      utm_source: utm.source,
      utm_medium: utm.medium,
      utm_campaign: utm.campaign,
      country,
      device,
      browser,
      os,
      ts: Date.now(),
    }),
    keepalive: true,
  }).catch(() => {})

  return res
}

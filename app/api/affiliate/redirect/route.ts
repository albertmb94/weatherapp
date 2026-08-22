import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { getFeature } from '@/lib/features'
import { isTrackingAllowed, CONSENT_COOKIE } from '@/lib/trackingConsent'

/** Allowlist of affiliate marketplaces. Anything outside this list is
 *  rejected so a malicious caller can't proxy any URL via our 302. */
const ALLOWED_MARKETPLACES = [
  // Amazon
  /^https:\/\/(www\.)?amazon\.(es|com|com\.mx|com\.br|de|fr|it|nl|co\.uk|ca|com\.au|jp|in|se|sg|pl|ae|sa|eg)$/i,
  /^https:\/\/(www\.)?amzn\.to$/i,
  /^https:\/\/(www\.)?amzn\.eu$/i,
  // Awin / generic affiliate networks
  /^https:\/\/(www\.)?awin1\.com$/i,
  /^https:\/\/(www\.)?booking\.com$/i,
]

function isAllowedMarketplace(target: string): boolean {
  try {
    const u = new URL(target)
    return ALLOWED_MARKETPLACES.some(re => re.test(u.origin))
  } catch {
    return false
  }
}

/** Server-side click tracker. Receives a redirect request, validates
 *  the destination against an allowlist, logs the click to
 *  `affiliate_clicks`, then 302s to the affiliate URL. Returning 302
 *  (rather than serving the link directly) lets us hide the outbound
 *  path from the user and gives us a reliable place to record clicks
 *  per anon_id. */
export async function GET(req: NextRequest) {
  const flag = await getFeature('feature.affiliates')
  if (!flag.enabled) {
    return NextResponse.json({ ok: false, error: 'affiliates_disabled' }, { status: 404 })
  }
  const program = req.nextUrl.searchParams.get('program') ?? ''
  const productId = req.nextUrl.searchParams.get('product_id') ?? ''
  const trigger = req.nextUrl.searchParams.get('trigger') ?? ''
  const target = req.nextUrl.searchParams.get('to') ?? ''
  if (!target.startsWith('https://')) {
    return NextResponse.json({ ok: false, error: 'invalid_target' }, { status: 400 })
  }
  if (!isAllowedMarketplace(target)) {
    return NextResponse.json({ ok: false, error: 'marketplace_not_allowed' }, { status: 400 })
  }
  // B-NBT-10 fix: this route is excluded from the proxy matcher, so
  // `x-anon-id` never arrives and every click used to log anon_id
  // 'unknown'. Read the cookie directly instead — and honour the same
  // consent gate (a declined visitor still gets redirected; we just
  // don't attribute the click).
  const trackingAllowed = isTrackingAllowed(req.cookies.get(CONSENT_COOKIE)?.value)
  const anonId = trackingAllowed
    ? (req.cookies.get('wthr_anon')?.value ?? 'unknown')
    : 'consent_denied'
  const id = randomBytes(10).toString('hex')
  try {
    await db.execute(
      `INSERT INTO affiliate_clicks (id, anon_id, program, product_id, trigger, ts) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, anonId, program, productId, trigger, Date.now()],
    )
  } catch {
    /* non-fatal — a click that fails to log should still redirect */
  }
  return NextResponse.redirect(target, { status: 302 })
}

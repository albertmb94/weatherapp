import { NextRequest, NextResponse } from 'next/server'
import { getRefreshStatus, recordRefresh } from '@/lib/appState'
import { purgeAllForecastCache } from '@/lib/forecastCache'
import { purgeAllMarineCache } from '@/lib/marineCache'
import { rateLimit } from '@/lib/rateLimit'

/** Same-origin check for the mutating verb: the refresh button is the
 *  only intended caller, and the purge is global state. Blocks
 *  cross-site form posts / scripted abuse from other origins. */
function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) {
    // Navegadores siempre envían Origin en fetch cross-origin; sin Origin
    // (curl, server-to-server) aceptamos solo si hay Sec-Fetch-Site
    // ausente O same-origin. Los navegadores modernos lo envían siempre.
    const site = req.headers.get('sec-fetch-site')
    return site === null || site === 'same-origin' || site === 'none'
  }
  try {
    return new URL(origin).host === req.headers.get('host')
  } catch {
    return false
  }
}

export async function GET() {
  try {
    const status = await getRefreshStatus()
    return NextResponse.json(status)
  } catch (err) {
    console.error('[refresh] status failed:', err)
    return NextResponse.json({ error: 'Failed to read refresh status' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'cross_origin_forbidden' }, { status: 403 })
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`refresh:${ip}`, 3, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
  try {
    const now = Date.now()
    const status = await getRefreshStatus(now)
    if (!status.canRefresh) {
      return NextResponse.json(
        { skipped: true, reason: 'cooldown', ...status },
        { status: 200 }
      )
    }
    const refreshedAt = await recordRefresh(now)
    // Wipe the forecast AND marine caches so the next GETs repopulate from
    // Open-Meteo (M7: previously only forecast was purged, so a refresh
    // would mix old marine data with new land data).
    try {
      await Promise.all([
        purgeAllForecastCache(),
        purgeAllMarineCache(),
      ])
    } catch (err) {
      console.warn('cache purge failed', err)
    }
    return NextResponse.json({ skipped: false, refreshedAt })
  } catch (err) {
    console.error('[refresh] failed:', err)
    return NextResponse.json({ error: 'Failed to refresh' }, { status: 500 })
  }
}

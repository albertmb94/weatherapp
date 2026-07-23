import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'

/**
 * Sprint 10 / B-10-5 (E1) — server-side reverse-geocode proxy with
 * aggressive CDN caching.
 *
 * Why: the BigDataCloud free tier allows 50k requests / month. The
 * browser used to call it directly on every map click / city change /
 * geolocate, easily consuming 9–90 % of the quota in a normal month.
 *
 * Wrapping the call behind `/api/reverse-geocode` lets us:
 *   1. Round the input coordinates to 2 decimals (~1.1 km) so users
 *      in the same neighborhood share a cache entry.
 *   2. Emit `Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800`
 *      so a CDN/Vercel edge serves ~99 % of requests without ever
 *      hitting BigDataCloud.
 *   3. Apply per-IP rate limiting as a safety net against a hot loop.
 *   4. Fail soft (return `null`) on upstream errors so the client
 *      never breaks because BigDataCloud is down.
 */
export async function GET(request: Request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  if (!rateLimit(`reverse-geocode:${ip}`, 60)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const lat = Number(searchParams.get('lat'))
  const lon = Number(searchParams.get('lon'))
  const locale = searchParams.get('locale') === 'en' ? 'en' : 'es'

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return NextResponse.json({ error: 'Invalid latitude' }, { status: 400 })
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Invalid longitude' }, { status: 400 })
  }

  // Round to 2 decimals (~1.1 km) so adjacent lookups share a cache
  // entry. The city name is stable at that granularity; the previous
  // client-side cache had no granularity at all.
  const roundedLat = lat.toFixed(2)
  const roundedLon = lon.toFixed(2)

  const url =
    `https://api.bigdatacloud.net/data/reverse-geocode-client` +
    `?latitude=${roundedLat}&longitude=${roundedLon}&localityLanguage=${locale}`

  try {
    const res = await fetch(url, {
      // Short upstream timeout — we'd rather fail fast and serve the
      // previous UI than hang the network round-trip.
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) {
      // Fail soft: return null so the client falls back to coords.
      return NextResponse.json(
        { name: null },
        { headers: CACHE_HEADERS }
      )
    }
    const data = (await res.json()) as {
      city?: string
      locality?: string
    }
    const name = data.city || data.locality || null
    return NextResponse.json(
      { name },
      { headers: CACHE_HEADERS }
    )
  } catch {
    return NextResponse.json({ name: null }, { headers: CACHE_HEADERS })
  }
}

const CACHE_HEADERS = {
  // 24 h fresh, 7 d stale-while-revalidate. Two-decimal rounding
  // means the cache key is naturally small and the hit rate is high.
  'Cache-Control':
    'public, s-maxage=86400, stale-while-revalidate=604800',
} as const

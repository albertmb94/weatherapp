import { NextResponse } from 'next/server'
import { fetchStationData } from '@/lib/meteoclimatic'
import { resolveMeteoclimaticPrefix } from '@/lib/meteoclimaticProvinces'
import { haversineKm } from '@/lib/geoDistance'
import { rateLimit } from '@/lib/rateLimit'

export const runtime = 'edge'

/**
 * Two request modes are supported (backwards-compatible):
 *  1. `?station={code}`  — single feed by code. Unchanged behaviour.
 *  2. `?lat=&lon=&radius=&limit=`  — resolve the Meteoclimatic province
 *     from the (lat, lon) pair, download the province feed, then
 *     filter by haversine ≤ radius and cut to limit.
 */
export async function GET(request: Request) {
  // B12: rate limit per IP (edge runtime keeps this in-instance only,
  // so it isn't shared across regions, but it still caps per-client
  // hammering within a region).
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`meteoclimatic:${ip}`, 30)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const station = searchParams.get('station')
  const latParam = searchParams.get('lat')
  const lonParam = searchParams.get('lon')

  // Mode 1: explicit station
  if (station) {
    if (!/^[A-Za-z0-9]+$/.test(station)) {
      return NextResponse.json({ error: 'Invalid station code' }, { status: 400 })
    }
    try {
      const stations = await fetchStationData(station)
      return NextResponse.json(
        { stations, fetchedAt: new Date().toISOString() },
        { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' } }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const status = message.includes('403') ? 403
        : message.includes('404') ? 404
        : message.includes('timeout') || message.includes('abort') ? 504
        : 502
      console.error(`[meteoclimatic] ${station}: ${message}`)
      return NextResponse.json(
        { error: 'Failed to fetch Meteoclimatic data', detail: message },
        { status }
      )
    }
  }

  // Mode 2: by coordinates
  if (latParam !== null || lonParam !== null) {
    const lat = Number(latParam)
    const lon = Number(lonParam)
    const radius = Number(searchParams.get('radius') ?? '30')
    const limit = Number(searchParams.get('limit') ?? '50')

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return NextResponse.json({ error: 'Invalid latitude (-90..90)' }, { status: 400 })
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      return NextResponse.json({ error: 'Invalid longitude (-180..180)' }, { status: 400 })
    }
    if (!Number.isFinite(radius) || radius < 1 || radius > 200) {
      return NextResponse.json({ error: 'Invalid radius (1..200 km)' }, { status: 400 })
    }
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      return NextResponse.json({ error: 'Invalid limit (1..200)' }, { status: 400 })
    }

    const prefix = resolveMeteoclimaticPrefix(lat, lon)
    if (!prefix) {
      return NextResponse.json(
        { stations: [], prefix: null, uncovered: true, fetchedAt: new Date().toISOString() },
        { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' } }
      )
    }

    try {
      const all = await fetchStationData(prefix)
      const center: [number, number] = [lat, lon]
      const within = all
        .map(s => ({ ...s, distanceKm: haversineKm([s.lat, s.lon], center) }))
        .filter(s => s.distanceKm <= radius)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, limit)
      return NextResponse.json(
        { stations: within, prefix, fetchedAt: new Date().toISOString() },
        { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' } }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[meteoclimatic] ${prefix}: ${message}`)
      return NextResponse.json(
        { error: 'Failed to fetch Meteoclimatic data', detail: message },
        { status: 502 }
      )
    }
  }

  return NextResponse.json({ error: 'Missing station or lat/lon' }, { status: 400 })
}

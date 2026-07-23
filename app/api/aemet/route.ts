import { NextResponse } from 'next/server'
import { fetchAemetStations, getStaleAemetStations, type AemetRaw } from '@/lib/aemet'
import { haversineKm } from '@/lib/geoDistance'
import { rateLimit } from '@/lib/rateLimit'
import {
  getFreshCachedStations,
  getStaleCachedStations,
  setCachedStations,
  parseStationsPayload,
} from '@/lib/externalStationsCache'

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`aemet:${ip}`, 30)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  if (!process.env.AEMET_API_KEY) {
    return NextResponse.json(
      { error: 'AEMET API key not configured. Add AEMET_API_KEY to .env.local', stations: [] },
      { status: 200 }
    )
  }

  const { searchParams } = new URL(request.url)
  const lat = searchParams.get('lat')
  const lon = searchParams.get('lon')
  const radius = Number(searchParams.get('radius') ?? '100')

  // Sprint 10 / B-10-5 (E6): consult the shared Turso cache first so a
  // cold lambda in serverless deployments doesn't burn the upstream
  // AEMET quota just to warm up. The in-process memo remains as the
  // innermost, fastest layer.
  const fresh = await getFreshCachedStations('aemet')
  let stations = fresh
    ? parseStationsPayload<AemetRaw[]>(fresh)
    : null
  let fetchedAt = fresh?.fetchedAt ?? null

  if (!stations) {
    try {
      stations = await fetchAemetStations()
      fetchedAt = Date.now()
      void setCachedStations('aemet', JSON.stringify(stations), fetchedAt).catch(err => {
        console.warn('[aemet] cache write failed', err)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[aemet] ${message}`)
      // Sprint 10: try the shared stale cache first, then the in-process
      // memo. Order matters: the shared cache survives cold starts.
      const stale = await getStaleCachedStations('aemet')
      const staleStations = stale ? parseStationsPayload<AemetRaw[]>(stale) : null
      if (stale && staleStations) {
        stations = staleStations
        fetchedAt = stale.fetchedAt
      } else {
        const memoStations = getStaleAemetStations()
        if (memoStations) {
          stations = memoStations
          fetchedAt = null
        } else {
          return NextResponse.json(
            { error: 'Failed to fetch AEMET data', detail: message },
            { status: 502 }
          )
        }
      }
    }
  }

  // Server-side geographic filtering: when lat/lon are provided, only return
  // stations within the requested radius. This dramatically reduces the
  // payload from ~900 stations to ~20-50, and offloads client-side filtering.
  let filtered = stations
  if (lat && lon) {
    const center: [number, number] = [Number(lat), Number(lon)]
    // Pre-filter with a cheap bounding-box check before the more expensive haversine
    const margin = radius / 111 // rough km-to-degrees conversion
    const latMin = center[0] - margin
    const latMax = center[0] + margin
    const lonMin = center[1] - margin
    const lonMax = center[1] + margin
    filtered = stations.filter(s => {
      if (s.lat < latMin || s.lat > latMax || s.lon < lonMin || s.lon > lonMax) return false
      return haversineKm([s.lat, s.lon], center) <= radius
    })
  }

  return NextResponse.json(
    {
      stations: filtered,
      fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
  )
}

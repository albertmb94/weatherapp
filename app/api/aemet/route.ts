import { NextResponse } from 'next/server'
import { fetchAemetStations, getStaleAemetStations, type AemetRaw } from '@/lib/aemet'
import { haversineKm } from '@/lib/geoDistance'
import { rateLimit } from '@/lib/rateLimit'

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

  try {
    let stations: AemetRaw[]
    try {
      stations = await fetchAemetStations()
    } catch {
      // If upstream fails but we have a stale memo, serve that instead.
      const stale = getStaleAemetStations()
      if (stale) {
        stations = stale
      } else {
        throw new Error('AEMET fetch failed and no stale data available')
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
      { stations: filtered, fetchedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[aemet] ${message}`)
    return NextResponse.json(
      { error: 'Failed to fetch AEMET data', detail: message },
      { status: 502 }
    )
  }
}

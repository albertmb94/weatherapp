import { NextResponse } from 'next/server'
import { fetchMeteocatStations } from '@/lib/meteocat'
import type { MeteoclimaticObservation } from '@/lib/meteoclimatic-types'
import { haversineKm } from '@/lib/geoDistance'
import { rateLimit } from '@/lib/rateLimit'

// Default Node runtime: full Intl (timezone) + access to the server-only
// METEOCAT_API_KEY secret.

const CACHE_HEADERS = {
  // XEMA refreshes ~every 30 min, so cache the (location-independent) whole
  // network response hard. One CDN cache entry serves all clients, which is
  // essential to stay under Meteocat's monthly quota.
  'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
}

// Second layer on top of the CDN: a per-instance memo so warm invocations
// don't re-hit the upstream within the cache window.
let memo: { at: number; stations: MeteoclimaticObservation[] } | null = null
const MEMO_TTL_MS = 25 * 60 * 1000

function filterByRadius(stations: MeteoclimaticObservation[], lat: number, lon: number, radius: number): MeteoclimaticObservation[] {
  const center: [number, number] = [lat, lon]
  const margin = radius / 111
  const latMin = lat - margin
  const latMax = lat + margin
  const lonMin = lon - margin
  const lonMax = lon + margin
  return stations.filter(s => {
    if (s.lat < latMin || s.lat > latMax || s.lon < lonMin || s.lon > lonMax) return false
    return haversineKm([s.lat, s.lon], center) <= radius
  })
}

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`meteocat:${ip}`, 30)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const apiKey = process.env.METEOCAT_API_KEY
  if (!apiKey) {
    // Not configured: behave as an empty, non-error source so the dashboard
    // simply shows no Meteocat stations instead of surfacing an error.
    return NextResponse.json(
      { stations: [], disabled: true, fetchedAt: new Date().toISOString() },
      { headers: CACHE_HEADERS }
    )
  }

  const { searchParams } = new URL(request.url)
  const lat = searchParams.get('lat')
  const lon = searchParams.get('lon')
  const radius = Number(searchParams.get('radius') ?? '100')

  if (memo && Date.now() - memo.at < MEMO_TTL_MS) {
    let stations = memo.stations
    if (lat && lon) {
      stations = filterByRadius(stations, Number(lat), Number(lon), radius)
    }
    return NextResponse.json(
      { stations, fetchedAt: new Date(memo.at).toISOString(), cached: true },
      { headers: CACHE_HEADERS }
    )
  }

  try {
    const allStations = await fetchMeteocatStations(apiKey)
    memo = { at: Date.now(), stations: allStations }
    let stations = allStations
    if (lat && lon) {
      stations = filterByRadius(stations, Number(lat), Number(lon), radius)
    }
    return NextResponse.json(
      { stations, fetchedAt: new Date().toISOString() },
      { headers: CACHE_HEADERS }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[meteocat] ${message}`)
    // Serve the last good in-memory snapshot if we have one.
    if (memo) {
      let stations = memo.stations
      if (lat && lon) {
        stations = filterByRadius(stations, Number(lat), Number(lon), radius)
      }
      return NextResponse.json(
        { stations, fetchedAt: new Date(memo.at).toISOString(), stale: true },
        { headers: CACHE_HEADERS }
      )
    }
    const status = /\b4\d\d\b/.test(message) ? 502 : 504
    return NextResponse.json(
      { error: 'Failed to fetch Meteocat data', detail: message },
      { status }
    )
  }
}

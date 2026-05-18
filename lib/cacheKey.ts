/**
 * Build a canonical cache key from Open-Meteo forecast request params.
 *
 * - `timezone` is dropped (we only use 'auto' / 'UTC' which doesn't change
 *   the data values, just the timestamp interpretation client-side).
 * - latitude / longitude are rounded to 1 decimal (~11 km) so clicks within
 *   the same neighborhood reuse the same cache entry.
 * - For bulk multi-location requests the (lat,lon) pairs are sorted as a
 *   set so the order in the URL doesn't matter.
 * - All other params are sorted alphabetically.
 */
const LATLON_DECIMALS = 1
const SKIP_PARAMS = new Set(['timezone'])

function roundCoord(s: string): string {
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  return n.toFixed(LATLON_DECIMALS)
}

function normalizeLatLon(params: URLSearchParams): { lat: string; lon: string } | null {
  const latRaw = params.get('latitude')
  const lonRaw = params.get('longitude')
  if (latRaw === null || lonRaw === null) return null

  const lats = latRaw.split(',').map(roundCoord)
  const lons = lonRaw.split(',').map(roundCoord)
  if (lats.length !== lons.length) {
    return { lat: lats.join(','), lon: lons.join(',') }
  }

  const pairs = lats.map((lat, i) => `${lat},${lons[i]}`)
  pairs.sort()
  const sortedLats: string[] = []
  const sortedLons: string[] = []
  for (const p of pairs) {
    const [la, lo] = p.split(',')
    sortedLats.push(la)
    sortedLons.push(lo)
  }
  return { lat: sortedLats.join(','), lon: sortedLons.join(',') }
}

export function buildForecastCacheKey(params: URLSearchParams): string {
  const entries: [string, string][] = []
  const latLon = normalizeLatLon(params)
  if (latLon) {
    entries.push(['latitude', latLon.lat])
    entries.push(['longitude', latLon.lon])
  }

  for (const [k, v] of params.entries()) {
    if (k === 'latitude' || k === 'longitude') continue
    if (SKIP_PARAMS.has(k)) continue
    entries.push([k, v])
  }

  entries.sort(([a], [b]) => a.localeCompare(b))
  return entries.map(([k, v]) => `${k}=${v}`).join('|')
}

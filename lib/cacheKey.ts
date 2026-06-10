/**
 * Build a canonical cache key from Open-Meteo forecast request params.
 *
 * - `timezone` is part of the key (M6): although we only ever forward
 *   `auto` / `UTC` to Open-Meteo, the server response (`hourly.time`,
 *   `utc_offset_seconds`) differs between them and omitting it from the
 *   key caused cache poisoning when one timezone value overwrote a cell
 *   previously fetched with the other.
 * - latitude / longitude are rounded to 2 decimals (~1.1 km) so clicks
 *   within the same neighborhood reuse the same cache entry.
 * - For bulk multi-location requests the (lat,lon) pairs are sorted as a
 *   set so the order in the URL doesn't matter.
 * - All other params are sorted alphabetically.
 */
const LATLON_DECIMALS = 2
const SKIP_PARAMS = new Set<string>()

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

/**
 * Build a cache key for the marine API. Same canonicalization rules as the
 * forecast key: lat/lon rounded to 2 decimals, multi-location pairs sorted
 * as a set, `timezone` dropped, other params sorted alphabetically. The
 * marine API does not accept `models=`, so that param is also skipped.
 */
export function buildMarineCacheKey(params: URLSearchParams): string {
  const entries: [string, string][] = []
  const latLon = normalizeLatLon(params)
  if (latLon) {
    entries.push(['latitude', latLon.lat])
    entries.push(['longitude', latLon.lon])
  }

  for (const [k, v] of params.entries()) {
    if (k === 'latitude' || k === 'longitude') continue
    if (k === 'models') continue
    if (SKIP_PARAMS.has(k)) continue
    entries.push([k, v])
  }

  entries.sort(([a], [b]) => a.localeCompare(b))
  return entries.map(([k, v]) => `${k}=${v}`).join('|')
}

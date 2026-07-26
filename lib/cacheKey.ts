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
/** Params stripped from the upstream URL only (the cache key keeps them
 *  so the version stamp acts as a cache-buster).
 *
 *   - `v` is the client-issued cache-bust stamp emitted by
 *     `lib/openMeteo.ts`. It must never reach the provider — Open-Meteo
 *     ignores it but it leaks the version in their access logs.
 */
export const STRIPPED_UPSTREAM_KEYS = new Set<string>(['v'])

/**
 * @deprecated Use `STRIPPED_UPSTREAM_KEYS` — the previous name was
 * misleading because only the upstream URL is stripped, not the cache
 * key itself. Kept as an alias for backwards compatibility with
 * external imports during the migration window.
 */
export const STRIPPED_KEYS = STRIPPED_UPSTREAM_KEYS

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
    entries.push([k, v])
  }

  entries.sort(([a], [b]) => a.localeCompare(b))
  return entries.map(([k, v]) => `${k}=${v}`).join('|')
}

/**
 * Build the upstream URL by stripping cache-buster params (`v`) so the
 * provider never sees them. Cache keys intentionally keep them so a
 * version bump invalidates entries without admin intervention.
 *
 * Returns a fresh `URLSearchParams` so callers can mutate without
 * affecting the incoming request.
 */
export function buildUpstreamParams(params: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams()
  for (const [k, v] of params.entries()) {
    if (STRIPPED_UPSTREAM_KEYS.has(k)) continue
    out.set(k, v)
  }
  return out
}

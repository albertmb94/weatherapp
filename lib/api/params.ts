/**
 * B-NBT-9c (2026-08-22): route-segment decoding that cannot throw.
 *
 * Every dynamic API route used to call `decodeURIComponent(params.x)`
 * inline; a segment containing a malformed escape sequence (e.g.
 * `/api/features/%zz`) made the decoder throw a URIError OUTSIDE any
 * try/catch, surfacing as a framework 500 instead of a clean 400.
 *
 * Returns null when the segment is not decodable — callers respond 400.
 */
export function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/**
 * B-NBT-9c: shared lat/lon guard for the Open-Meteo proxy routes
 * (forecast / marine / air-quality). Junk or MISSING coordinates used
 * to be forwarded upstream verbatim (`Number(null)` === 0 silently
 * pointed at the Gulf of Guinea), burning provider quota and
 * polluting the Turso cache-key space. Returns a human-readable error
 * string, or null when the pair is valid.
 */
export function validateLatLon(
  latRaw: string | null,
  lonRaw: string | null,
): string | null {
  if (latRaw === null || lonRaw === null || latRaw === '' || lonRaw === '') {
    return 'Missing coordinates'
  }
  const lat = Number(latRaw)
  const lon = Number(lonRaw)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Invalid latitude'
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return 'Invalid longitude'
  return null
}

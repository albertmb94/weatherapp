/**
 * Sprint 10 / B-10-5 — client-side reverse-geocode that hits the
 * server proxy, not BigDataCloud directly.
 *
 * Before: every map click / city select / geolocate called the
 * BigDataCloud upstream from the browser with no cache, eating the
 * 50 k/month free quota fast.
 *
 * After: we call our own `/api/reverse-geocode` which:
 *   - rounds lat/lon to 2 decimals (~1.1 km) for cache friendliness,
 *   - emits `Cache-Control: s-maxage=86400, stale-while-revalidate=604800`,
 *   - returns null on upstream failure so the caller can fall back to
 *     displaying the raw coordinates.
 */
export interface ReverseGeocodeResult {
  city?: string
  locality?: string
  localityInfo?: { administrative?: Array<{ name: string; description?: string }> }
}

export async function reverseGeocode(
  lat: number,
  lon: number,
  locale: 'en' | 'es'
): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lon.toString(),
      locale,
    })
    const res = await fetch(`/api/reverse-geocode?${params}`, {
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { name: string | null }
    return data.name
  } catch {
    return null
  }
}

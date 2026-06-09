export interface ReverseGeocodeResult {
  city?: string
  locality?: string
  localityInfo?: { administrative?: Array<{ name: string; description?: string }> }
}

export async function reverseGeocode(lat: number, lon: number, locale: 'en' | 'es'): Promise<string | null> {
  try {
    const lang = locale === 'en' ? 'en' : 'es'
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${lang}`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const data = (await res.json()) as ReverseGeocodeResult
    return data.city || data.locality || null
  } catch {
    return null
  }
}

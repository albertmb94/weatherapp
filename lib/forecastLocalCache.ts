import { parseOpenMeteoTimes } from './dateUtils'

const CACHE_KEY = 'weather-forecast-cache'
const CACHE_TTL_MS = 4 * 60 * 60 * 1000

interface ForecastCacheEntry {
  key: string
  data: unknown
  fetchedAt: number
}

function buildKey(lat: number, lon: number, forecastDays: number, marine: boolean): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}|${forecastDays}|${marine ? 1 : 0}`
}

export function getLocalForecastCache(
  lat: number,
  lon: number,
  forecastDays: number,
  marine: boolean
): { data: unknown; ageMs: number } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const entries = JSON.parse(raw) as ForecastCacheEntry[]
    const key = buildKey(lat, lon, forecastDays, marine)
    const entry = entries.find(e => e.key === key)
    if (!entry) return null
    const ageMs = Date.now() - entry.fetchedAt
    if (ageMs > CACHE_TTL_MS) return null
    const cached = entry.data as { time?: unknown[]; timeStrings?: unknown[]; utcOffsetSeconds?: number; series?: unknown }
    if (cached?.timeStrings && Array.isArray(cached.timeStrings) && typeof cached.timeStrings[0] === 'string') {
      cached.time = parseOpenMeteoTimes(cached.timeStrings as string[])
    } else if (cached?.time && Array.isArray(cached.time) && typeof cached.time[0] === 'string') {
      cached.time = parseOpenMeteoTimes(cached.time as string[])
    }
    // Rebuild timeStrings if missing so downstream code can always slice it
    if (!cached.timeStrings && cached.time && Array.isArray(cached.time)) {
      cached.timeStrings = (cached.time as Date[]).map(t => (t as Date).toISOString())
    }
    return { data: cached, ageMs }
  } catch {
    return null
  }
}

export function setLocalForecastCache(
  lat: number,
  lon: number,
  forecastDays: number,
  marine: boolean,
  data: unknown
): void {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const entries: ForecastCacheEntry[] = raw ? JSON.parse(raw) : []
    const key = buildKey(lat, lon, forecastDays, marine)
    const idx = entries.findIndex(e => e.key === key)
    // Ensure timeStrings is present before saving so Date objects survive JSON
    const safe = data as { time?: Date[]; timeStrings?: string[]; series?: unknown; utcOffsetSeconds?: number }
    if (!safe.timeStrings && safe.time && Array.isArray(safe.time)) {
      safe.timeStrings = safe.time.map(t => (t as Date).toISOString())
    }
    const entry: ForecastCacheEntry = { key, data: safe, fetchedAt: Date.now() }
    if (idx >= 0) entries[idx] = entry
    else entries.push(entry)
    // Keep only last 20 entries
    if (entries.length > 20) entries.shift()
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries))
  } catch {
    // ignore
  }
}

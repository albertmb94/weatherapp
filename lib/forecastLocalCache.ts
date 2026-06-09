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
    const cached = entry.data as { time?: unknown[]; utcOffsetSeconds?: number; series?: unknown }
    if (cached?.time && Array.isArray(cached.time) && typeof cached.time[0] === 'string') {
      cached.time = parseOpenMeteoTimes(cached.time as string[])
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
    const entry: ForecastCacheEntry = { key, data, fetchedAt: Date.now() }
    if (idx >= 0) entries[idx] = entry
    else entries.push(entry)
    // Keep only last 20 entries
    if (entries.length > 20) entries.shift()
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries))
  } catch {
    // ignore
  }
}

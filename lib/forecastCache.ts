import { createCacheStore, type CachedEntry } from './cacheStore'
import { REFRESH_WINDOW_MS } from './refreshWindow'

const store = createCacheStore({
  tableName: 'forecast_cache',
  ttlMs: REFRESH_WINDOW_MS,
  // B-NBT-9c: purge horizon now MATCHES maxStaleMs. The old value
  // (fresh + 2h = 4h) deleted rows long before the documented 24h
  // stale ceiling, making `getStale`'s guard unreachable — during an
  // outage the fallback silently degraded from "up to 24h" to
  // "at most ~4h". Rows are small; a day of retention per cell is cheap.
  purgeOlderThanMs: 24 * 60 * 60 * 1000,
  // Beyond 24h the forecast is too stale to ever serve as a "fallback" —
  // the routes return 503 instead of feeding an arbitrary snapshot to a CDN.
  maxStaleMs: 24 * 60 * 60 * 1000,
})

export async function getCachedForecast(cacheKey: string, now?: number): Promise<CachedEntry | null> {
  return store.get(cacheKey, now)
}

export async function getCachedForecastStale(cacheKey: string, now?: number): Promise<CachedEntry | null> {
  return store.getStale(cacheKey, now)
}

export async function setCachedForecast(cacheKey: string, body: string, now?: number): Promise<void> {
  return store.set(cacheKey, body, now)
}

export async function purgeAllForecastCache(): Promise<void> {
  return store.purgeAll()
}

export type { CachedEntry }

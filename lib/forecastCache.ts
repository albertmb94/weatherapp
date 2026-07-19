import { createCacheStore, type CachedEntry } from './cacheStore'

const store = createCacheStore({
  tableName: 'forecast_cache',
  ttlMs: 4 * 60 * 60 * 1000,
  purgeOlderThanMs: 6 * 60 * 60 * 1000,
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

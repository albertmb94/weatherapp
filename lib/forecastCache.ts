import { createCacheStore, type CachedEntry } from './cacheStore'

const store = createCacheStore({
  tableName: 'forecast_cache',
  ttlMs: 4 * 60 * 60 * 1000,
  purgeOlderThanMs: 6 * 60 * 60 * 1000,
})

export const FORECAST_CACHE_TTL_MS = store.ttlMs

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

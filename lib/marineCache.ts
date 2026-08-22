import { createCacheStore, type CachedEntry } from './cacheStore'
import { REFRESH_WINDOW_MS } from './refreshWindow'

const store = createCacheStore({
  tableName: 'marine_cache',
  ttlMs: REFRESH_WINDOW_MS,
  // B-NBT-9c: matches maxStaleMs (was fresh+2h, which made the 24h
  // stale ceiling unreachable). Same rationale as lib/forecastCache.ts.
  purgeOlderThanMs: 24 * 60 * 60 * 1000,
  maxStaleMs: 24 * 60 * 60 * 1000,
})

export async function getCachedMarine(cacheKey: string, now?: number): Promise<CachedEntry | null> {
  return store.get(cacheKey, now)
}

export async function getCachedMarineStale(cacheKey: string, now?: number): Promise<CachedEntry | null> {
  return store.getStale(cacheKey, now)
}

export async function setCachedMarine(cacheKey: string, body: string, now?: number): Promise<void> {
  return store.set(cacheKey, body, now)
}

export async function purgeAllMarineCache(): Promise<void> {
  return store.purgeAll()
}

export type { CachedEntry as CachedMarineEntry }

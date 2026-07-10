import { createCacheStore, type CachedEntry } from './cacheStore'

const store = createCacheStore({
  tableName: 'marine_cache',
  ttlMs: 4 * 60 * 60 * 1000,
  purgeOlderThanMs: 6 * 60 * 60 * 1000,
})

export const MARINE_CACHE_TTL_MS = store.ttlMs

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

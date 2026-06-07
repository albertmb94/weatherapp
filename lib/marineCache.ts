import { getDb } from '@/lib/db'

const TTL_MS = 4 * 60 * 60 * 1000
const PURGE_OLDER_THAN_MS = 6 * 60 * 60 * 1000

let initPromise: Promise<void> | null = null

function ensureSchema(): Promise<void> {
  if (!initPromise) {
    initPromise = getDb()
      .execute(`
        CREATE TABLE IF NOT EXISTS marine_cache (
          cache_key TEXT PRIMARY KEY,
          body TEXT NOT NULL,
          fetched_at INTEGER NOT NULL
        )
      `)
      .then(() => undefined)
      .catch(err => {
        initPromise = null
        throw err
      })
  }
  return initPromise
}

export interface CachedMarineEntry {
  body: string
  fetchedAt: number
  ageMs: number
}

export async function getCachedMarine(cacheKey: string, now: number = Date.now()): Promise<CachedMarineEntry | null> {
  await ensureSchema()
  const result = await getDb().execute({
    sql: 'SELECT body, fetched_at FROM marine_cache WHERE cache_key = ?',
    args: [cacheKey],
  })
  const row = result.rows[0] as unknown as { body: string; fetched_at: number } | undefined
  if (!row) return null
  const fetchedAt = Number(row.fetched_at)
  const ageMs = now - fetchedAt
  if (ageMs > TTL_MS) return null
  return { body: row.body, fetchedAt, ageMs }
}

export async function getCachedMarineStale(cacheKey: string, now: number = Date.now()): Promise<CachedMarineEntry | null> {
  await ensureSchema()
  const result = await getDb().execute({
    sql: 'SELECT body, fetched_at FROM marine_cache WHERE cache_key = ?',
    args: [cacheKey],
  })
  const row = result.rows[0] as unknown as { body: string; fetched_at: number } | undefined
  if (!row) return null
  return { body: row.body, fetchedAt: Number(row.fetched_at), ageMs: now - Number(row.fetched_at) }
}

export async function setCachedMarine(cacheKey: string, body: string, now: number = Date.now()): Promise<void> {
  await ensureSchema()
  await getDb().execute({
    sql: `INSERT INTO marine_cache (cache_key, body, fetched_at) VALUES (?, ?, ?)
          ON CONFLICT(cache_key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
    args: [cacheKey, body, now],
  })
  try {
    await getDb().execute({
      sql: 'DELETE FROM marine_cache WHERE fetched_at < ?',
      args: [now - PURGE_OLDER_THAN_MS],
    })
  } catch {
    // Ignore prune failures.
  }
}

export async function purgeAllMarineCache(): Promise<void> {
  await ensureSchema()
  await getDb().execute('DELETE FROM marine_cache')
}

export { TTL_MS as MARINE_CACHE_TTL_MS }

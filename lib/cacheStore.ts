import { getDb } from '@/lib/db'

export interface CachedEntry {
  body: string
  fetchedAt: number
  ageMs: number
}

interface CacheStoreOptions {
  tableName: string
  ttlMs: number
  purgeOlderThanMs: number
}

export function createCacheStore({ tableName, ttlMs, purgeOlderThanMs }: CacheStoreOptions) {
  let initPromise: Promise<void> | null = null

  function ensureSchema(): Promise<void> {
    if (!initPromise) {
      initPromise = getDb()
        .execute(`
          CREATE TABLE IF NOT EXISTS ${tableName} (
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

  async function get(cacheKey: string, now: number = Date.now()): Promise<CachedEntry | null> {
    await ensureSchema()
    const result = await getDb().execute({
      sql: `SELECT body, fetched_at FROM ${tableName} WHERE cache_key = ?`,
      args: [cacheKey],
    })
    const row = result.rows[0] as unknown as { body: string; fetched_at: number } | undefined
    if (!row) return null
    const fetchedAt = Number(row.fetched_at)
    const ageMs = now - fetchedAt
    if (ageMs > ttlMs) return null
    return { body: row.body, fetchedAt, ageMs }
  }

  async function getStale(cacheKey: string, now: number = Date.now()): Promise<CachedEntry | null> {
    await ensureSchema()
    const result = await getDb().execute({
      sql: `SELECT body, fetched_at FROM ${tableName} WHERE cache_key = ?`,
      args: [cacheKey],
    })
    const row = result.rows[0] as unknown as { body: string; fetched_at: number } | undefined
    if (!row) return null
    return { body: row.body, fetchedAt: Number(row.fetched_at), ageMs: now - Number(row.fetched_at) }
  }

  async function set(cacheKey: string, body: string, now: number = Date.now()): Promise<void> {
    await ensureSchema()
    await getDb().execute({
      sql: `INSERT INTO ${tableName} (cache_key, body, fetched_at) VALUES (?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
      args: [cacheKey, body, now],
    })
    try {
      await getDb().execute({
        sql: `DELETE FROM ${tableName} WHERE fetched_at < ?`,
        args: [now - purgeOlderThanMs],
      })
    } catch {
      // Ignore prune failures.
    }
  }

  async function purgeAll(): Promise<void> {
    await ensureSchema()
    await getDb().execute(`DELETE FROM ${tableName}`)
  }

  return { get, getStale, set, purgeAll, ttlMs }
}

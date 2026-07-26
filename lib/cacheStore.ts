import { db } from '@/lib/db'

export interface CachedEntry {
  body: string
  fetchedAt: number
  ageMs: number
}

interface CacheStoreOptions {
  tableName: string
  ttlMs: number
  purgeOlderThanMs: number
  /** Hard ceiling for how old a *stale* fallback may be. Outside this
   *  window `getStale()` returns null and callers must treat the request
   *  as a hard failure rather than serving an arbitrary-old forecast. */
  maxStaleMs: number
}

export function createCacheStore({ tableName, ttlMs, purgeOlderThanMs, maxStaleMs }: CacheStoreOptions) {
  let schemaReady: Promise<boolean> | null = null

  async function ensureSchema(): Promise<boolean> {
    if (schemaReady) return schemaReady
    schemaReady = db.ensure().then(ok => {
      if (!ok) return false
      return db.execute(
        `CREATE TABLE IF NOT EXISTS ${tableName} (
          cache_key TEXT PRIMARY KEY,
          body TEXT NOT NULL,
          fetched_at INTEGER NOT NULL
        )`,
      )
    }).catch(() => false)
    return schemaReady
  }

  async function get(cacheKey: string, now: number = Date.now()): Promise<CachedEntry | null> {
    if (!(await ensureSchema())) return null
    const rows = await db.select<{ body: string; fetched_at: number }>(
      `SELECT body, fetched_at FROM ${tableName} WHERE cache_key = ?`,
      [cacheKey],
    )
    const row = rows[0]
    if (!row) return null
    const fetchedAt = Number(row.fetched_at)
    const ageMs = now - fetchedAt
    if (ageMs > ttlMs) return null
    return { body: row.body, fetchedAt, ageMs }
  }

  async function getStale(cacheKey: string, now: number = Date.now()): Promise<CachedEntry | null> {
    if (!(await ensureSchema())) return null
    const rows = await db.select<{ body: string; fetched_at: number }>(
      `SELECT body, fetched_at FROM ${tableName} WHERE cache_key = ?`,
      [cacheKey],
    )
    const row = rows[0]
    if (!row) return null
    const fetchedAt = Number(row.fetched_at)
    const ageMs = now - fetchedAt
    // We don't return anything older than `maxStaleMs` so the caller can't
    // present an arbitrary-old forecast as fresh. Previously `getStale`
    // returned every row regardless of age and the route served it as
    // `Cache-Control: public, s-maxage=14400`, which made a 30-day-old
    // response live another 4h in any shared cache.
    if (ageMs > maxStaleMs) return null
    return { body: row.body, fetchedAt, ageMs }
  }

  async function set(cacheKey: string, body: string, now: number = Date.now()): Promise<void> {
    if (!(await ensureSchema())) return
    await db.execute(
      `INSERT INTO ${tableName} (cache_key, body, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
      [cacheKey, body, now],
    )
    try {
      await db.execute(
        `DELETE FROM ${tableName} WHERE fetched_at < ?`,
        [now - purgeOlderThanMs],
      )
    } catch (err) {
      // Surface prune failures to the server log so silent table growth
      // doesn't go unnoticed.
      console.warn(`[cacheStore:${tableName}] prune failed`, err)
    }
  }

  async function purgeAll(): Promise<void> {
    if (!(await ensureSchema())) return
    await db.execute(`DELETE FROM ${tableName}`)
  }

  return { get, getStale, set, purgeAll, ttlMs, maxStaleMs }
}

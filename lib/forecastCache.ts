import { getDb } from '@/lib/db'

const TTL_MS = 4 * 60 * 60 * 1000
const PURGE_OLDER_THAN_MS = 6 * 60 * 60 * 1000

let initPromise: Promise<void> | null = null

function ensureSchema(): Promise<void> {
  if (!initPromise) {
    initPromise = getDb()
      .execute(`
        CREATE TABLE IF NOT EXISTS forecast_cache (
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

export interface CachedEntry {
  body: string
  fetchedAt: number
  ageMs: number
}

export async function getCachedForecast(cacheKey: string, now: number = Date.now()): Promise<CachedEntry | null> {
  await ensureSchema()
  const result = await getDb().execute({
    sql: 'SELECT body, fetched_at FROM forecast_cache WHERE cache_key = ?',
    args: [cacheKey],
  })
  const row = result.rows[0] as unknown as { body: string; fetched_at: number } | undefined
  if (!row) return null
  const fetchedAt = Number(row.fetched_at)
  const ageMs = now - fetchedAt
  if (ageMs > TTL_MS) return null
  return { body: row.body, fetchedAt, ageMs }
}

/**
 * Returns cached data even if stale (>4h), or null if no entry exists.
 * Used as a fallback when Open-Meteo is unreachable.
 */
export async function getCachedForecastStale(cacheKey: string, now: number = Date.now()): Promise<CachedEntry | null> {
  await ensureSchema()
  const result = await getDb().execute({
    sql: 'SELECT body, fetched_at FROM forecast_cache WHERE cache_key = ?',
    args: [cacheKey],
  })
  const row = result.rows[0] as unknown as { body: string; fetched_at: number } | undefined
  if (!row) return null
  return { body: row.body, fetchedAt: Number(row.fetched_at), ageMs: now - Number(row.fetched_at) }
}

export async function setCachedForecast(cacheKey: string, body: string, now: number = Date.now()): Promise<void> {
  await ensureSchema()
  await getDb().execute({
    sql: `INSERT INTO forecast_cache (cache_key, body, fetched_at) VALUES (?, ?, ?)
          ON CONFLICT(cache_key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
    args: [cacheKey, body, now],
  })
  // Best-effort prune of clearly stale rows.
  try {
    await getDb().execute({
      sql: 'DELETE FROM forecast_cache WHERE fetched_at < ?',
      args: [now - PURGE_OLDER_THAN_MS],
    })
  } catch {
    // Ignore prune failures.
  }
}

export async function purgeAllForecastCache(): Promise<void> {
  await ensureSchema()
  await getDb().execute('DELETE FROM forecast_cache')
}

export { TTL_MS as FORECAST_CACHE_TTL_MS }

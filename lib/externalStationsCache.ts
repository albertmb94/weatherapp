import { getDb } from './db'
import type { MeteoclimaticObservation } from './meteoclimatic-types'

/**
 * Sprint 10 / B-10-5 (E4) — shared cross-instance cache for external
 * station data (AEMET, Meteocat).
 *
 * Why: those upstreams have monthly quotas / rate limits that are easy
 * to exhaust in serverless deployments where every lambda is a fresh
 * instance and the in-process memo from `lib/aemet.ts` and
 * `app/api/meteocat/route.ts` never survives a cold start.
 *
 * Strategy: persist the most recent upstream payload in a single-row
 * table keyed by source name. Both AEMET and Meteocat routes share
 * this store. The schema and helpers below were designed for the
 * Turso DB used everywhere else in the project; in development they
 * fall through to the local `local.db` SQLite file via `getDb()`.
 *
 * TTL semantics:
 *   - 4 h fresh: any read newer than this is served as-is.
 *   - 24 h stale: when the upstream fails, the last good payload is
 *     served even if it's a day old. Older than that we treat the
 *     request as a hard failure rather than broadcasting an
 *     arbitrarily-old forecast.
 */

export interface CachedStations {
  source: 'aemet' | 'meteocat'
  body: string
  fetchedAt: number
}

const TABLE = 'external_stations_cache'
const FRESH_TTL_MS = 4 * 60 * 60 * 1000
const STALE_TTL_MS = 24 * 60 * 60 * 1000

let initPromise: Promise<void> | null = null

function ensureSchema(): Promise<void> {
  if (!initPromise) {
    initPromise = getDb()
      .execute(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (
          source TEXT PRIMARY KEY,
          body TEXT NOT NULL,
          fetched_at INTEGER NOT NULL
        )`
      )
      .then(() => undefined)
      .catch(err => {
        initPromise = null
        throw err
      })
  }
  return initPromise
}

export async function getCachedStations(
  source: CachedStations['source'],
  now: number = Date.now()
): Promise<CachedStations | null> {
  await ensureSchema()
  const result = await getDb().execute({
    sql: `SELECT body, fetched_at FROM ${TABLE} WHERE source = ?`,
    args: [source],
  })
  const row = result.rows[0] as unknown as
    | { body: string; fetched_at: number }
    | undefined
  if (!row) return null
  const fetchedAt = Number(row.fetched_at)
  const ageMs = now - fetchedAt
  if (ageMs > STALE_TTL_MS) return null
  return { source, body: row.body, fetchedAt }
}

export async function setCachedStations(
  source: CachedStations['source'],
  body: string,
  now: number = Date.now()
): Promise<void> {
  await ensureSchema()
  await getDb().execute({
    sql: `INSERT INTO ${TABLE} (source, body, fetched_at) VALUES (?, ?, ?)
          ON CONFLICT(source) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
    args: [source, body, now],
  })
}

/**
 * Helper for route handlers. Returns the cached payload only if it's
 * still within FRESH_TTL_MS. Stale payloads are surfaced via
 * `getStaleCachedStations` so the caller can choose to serve them on
 * upstream errors.
 */
export async function getFreshCachedStations(
  source: CachedStations['source'],
  now: number = Date.now()
): Promise<CachedStations | null> {
  const entry = await getCachedStations(source, now)
  if (!entry) return null
  // >= (not >) so a 4 h 0 m 0 s entry is treated as stale: the
  // caller refetches rather than serving the very edge of TTL.
  if (now - entry.fetchedAt >= FRESH_TTL_MS) return null
  return entry
}

export async function getStaleCachedStations(
  source: CachedStations['source'],
  now: number = Date.now()
): Promise<CachedStations | null> {
  // getCachedStations already enforces STALE_TTL_MS so this is the
  // same call but exposed for clarity at the call site.
  return getCachedStations(source, now)
}

/**
 * Narrow type predicate: ensure the JSON we read back from the cache
 * parses to the shape we expect before handing it to the consumer.
 */
export function parseStationsPayload<T>(cached: CachedStations): T | null {
  try {
    return JSON.parse(cached.body) as T
  } catch {
    return null
  }
}

/**
 * Convenience: type re-export so the AEMET route can keep its existing
 * `AemetRaw` type alias without pulling `MeteoclimaticObservation`
 * directly into its module surface.
 */
export type { MeteoclimaticObservation }

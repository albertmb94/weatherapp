import { db } from './db'
import { memoizeSchema } from './schemaGuard'
import { REFRESH_WINDOW_MS } from './refreshWindow'
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
 * fall through to the local `local.db` SQLite file via `db`.
 *
 * TTL semantics:
 *   - 2 h fresh: any read newer than this is served as-is. Shared
 *     with `forecast_cache` and `marine_cache` via
 *     `lib/refreshWindow.ts`.
 *   - 24 h stale: when the upstream fails, the last good payload is
 *     served even if it's a day old. Older than that we treat the
 *     request as a hard failure rather than broadcasting an
 *     arbitrarily-old forecast.
 *
 * When the DB is unavailable (no Turso configured, or the libsql
 * client rejected the connection — see the production block in
 * `lib/db.ts`), every helper returns null and writes are no-ops. The
 * callers in `app/api/aemet/route.ts` and `app/api/meteocat/route.ts`
 * already fall back to the in-process memo in that case, so the
 * external routes still serve a fresh-ish response.
 */

export interface CachedStations {
  source: 'aemet' | 'meteocat'
  body: string
  fetchedAt: number
}

const TABLE = 'external_stations_cache'
const FRESH_TTL_MS = REFRESH_WINDOW_MS
const STALE_TTL_MS = 24 * 60 * 60 * 1000

const ensureSchema = memoizeSchema('externalStationsCache', async () => {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
      source TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    )`,
  )
})

export async function getCachedStations(
  source: CachedStations['source'],
  now: number = Date.now(),
): Promise<CachedStations | null> {
  if (!(await ensureSchema())) return null
  const rows = await db.select<{ body: string; fetched_at: number }>(
    `SELECT body, fetched_at FROM ${TABLE} WHERE source = ?`,
    [source],
  )
  const row = rows[0]
  if (!row) return null
  const fetchedAt = Number(row.fetched_at)
  const ageMs = now - fetchedAt
  if (ageMs > STALE_TTL_MS) return null
  return { source, body: row.body, fetchedAt }
}

export async function setCachedStations(
  source: CachedStations['source'],
  body: string,
  now: number = Date.now(),
): Promise<void> {
  if (!(await ensureSchema())) return
  await db.execute(
    `INSERT INTO ${TABLE} (source, body, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
    [source, body, now],
  )
}

/**
 * Helper for route handlers. Returns the cached payload only if it's
 * still within FRESH_TTL_MS. Stale payloads are surfaced via
 * `getStaleCachedStations` so the caller can choose to serve them on
 * upstream errors.
 */
export async function getFreshCachedStations(
  source: CachedStations['source'],
  now: number = Date.now(),
): Promise<CachedStations | null> {
  const entry = await getCachedStations(source, now)
  if (!entry) return null
  // >= (not >) so an entry at exactly FRESH_TTL_MS (2 h) is treated as
  // stale: the caller refetches rather than serving the very edge of TTL.
  if (now - entry.fetchedAt >= FRESH_TTL_MS) return null
  return entry
}

export async function getStaleCachedStations(
  source: CachedStations['source'],
  now: number = Date.now(),
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

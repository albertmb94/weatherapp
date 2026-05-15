import { getDb } from '@/lib/db'

const LAST_REFRESH_KEY = 'last_models_refresh'
const COOLDOWN_MS = 4 * 60 * 60 * 1000

let initPromise: Promise<void> | null = null

function ensureSchema(): Promise<void> {
  if (!initPromise) {
    initPromise = getDb()
      .execute(`
        CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
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

export async function getLastRefresh(): Promise<number | null> {
  await ensureSchema()
  const result = await getDb().execute({
    sql: 'SELECT updated_at FROM app_state WHERE key = ?',
    args: [LAST_REFRESH_KEY],
  })
  const row = result.rows[0] as unknown as { updated_at: number } | undefined
  return row ? Number(row.updated_at) : null
}

export async function recordRefresh(now: number = Date.now()): Promise<number> {
  await ensureSchema()
  await getDb().execute({
    sql: `INSERT INTO app_state (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [LAST_REFRESH_KEY, new Date(now).toISOString(), now],
  })
  return now
}

export interface RefreshStatus {
  lastRefreshedAt: number | null
  ageMs: number | null
  canRefresh: boolean
  cooldownMs: number
}

export async function getRefreshStatus(now: number = Date.now()): Promise<RefreshStatus> {
  const last = await getLastRefresh()
  const ageMs = last == null ? null : now - last
  const canRefresh = last == null || ageMs! >= COOLDOWN_MS
  return { lastRefreshedAt: last, ageMs, canRefresh, cooldownMs: COOLDOWN_MS }
}

export { COOLDOWN_MS }

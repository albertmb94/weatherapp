import { db } from '@/lib/db'
import { REFRESH_WINDOW_MS } from '@/lib/refreshWindow'

const LAST_REFRESH_KEY = 'last_models_refresh'
const COOLDOWN_MS = REFRESH_WINDOW_MS

// In-memory fallback for environments where the Turso DB is unavailable
// (Vercel deployments without TURSO_DATABASE_URL, or local dev when the
// libsql client reports reads/writes as blocked). The data is lost on
// cold start, but the API still returns a sensible shape so the UI can
// show "Never refreshed" instead of failing the whole route.
let memory: { lastRefreshedAt: number | null } = { lastRefreshedAt: null }

let schemaReady: Promise<boolean> | null = null

async function ensureSchema(): Promise<boolean> {
  if (schemaReady) return schemaReady
  schemaReady = db.ensure().then(ok => {
    if (!ok) return false
    return db.execute(
      `CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
  }).catch(() => false)
  return schemaReady
}

export async function getLastRefresh(): Promise<number | null> {
  if (!(await ensureSchema())) return memory.lastRefreshedAt
  const rows = await db.select<{ updated_at: number }>(
    'SELECT updated_at FROM app_state WHERE key = ?',
    [LAST_REFRESH_KEY],
  )
  const row = rows[0]
  if (row) return Number(row.updated_at)
  return memory.lastRefreshedAt
}

export async function recordRefresh(now: number = Date.now()): Promise<number> {
  memory = { lastRefreshedAt: now }
  if (!(await ensureSchema())) return now
  await db.execute(
    `INSERT INTO app_state (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [LAST_REFRESH_KEY, new Date(now).toISOString(), now],
  )
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

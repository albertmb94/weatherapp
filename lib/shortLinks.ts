import { db } from '@/lib/db'

const TTL_DAYS = 90
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000

let schemaReady: Promise<boolean> | null = null

async function ensureSchema(): Promise<boolean> {
  if (schemaReady) return schemaReady
  schemaReady = db.ensure().then(ok => {
    if (!ok) return false
    return db.execute(
      `CREATE TABLE IF NOT EXISTS short_links (
        id TEXT PRIMARY KEY,
        snapshot TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    )
  }).catch(() => false)
  return schemaReady
}

// F-9: short links stored in our own DB so we don't depend on any
// external service. Snapshot is the JSON-encoded URL params from
// `useUrlState` (excluding `locale` and `basic` which are device-local).
// When the DB is unavailable (no Turso configured, or the libsql client
// reported the connection as blocked), the writes are no-ops and the
// reads return null. The caller falls back to the original URL.
export async function saveShortLink(id: string, snapshot: string): Promise<boolean> {
  if (!(await ensureSchema())) return false
  return db.execute(
    'INSERT OR REPLACE INTO short_links (id, snapshot, created_at) VALUES (?, ?, ?)',
    [id, snapshot, Date.now()],
  )
}

export async function loadShortLink(id: string, now: number = Date.now()): Promise<string | null> {
  if (!(await ensureSchema())) return null
  const rows = await db.select<{ snapshot: string; created_at: number }>(
    'SELECT snapshot, created_at FROM short_links WHERE id = ?',
    [id],
  )
  const row = rows[0]
  if (!row) return null
  const ageMs = now - Number(row.created_at)
  if (ageMs > TTL_MS) return null
  return row.snapshot
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
export function generateShortId(length = 8): string {
  let out = ''
  const bytes = new Uint8Array(length)
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  for (let i = 0; i < length; i++) {
    out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length]
  }
  return out
}

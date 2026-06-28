import { getDb } from '@/lib/db'

const TTL_DAYS = 90
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000

let initPromise: Promise<void> | null = null

function ensureSchema(): Promise<void> {
  if (!initPromise) {
    initPromise = getDb()
      .execute(`
        CREATE TABLE IF NOT EXISTS short_links (
          id TEXT PRIMARY KEY,
          snapshot TEXT NOT NULL,
          created_at INTEGER NOT NULL
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

// F-9: short links stored in our own DB so we don't depend on any
// external service. Snapshot is the JSON-encoded URL params from
// `useUrlState` (excluding `locale` and `basic` which are device-local).
export async function saveShortLink(id: string, snapshot: string): Promise<void> {
  await ensureSchema()
  await getDb().execute({
    sql: 'INSERT OR REPLACE INTO short_links (id, snapshot, created_at) VALUES (?, ?, ?)',
    args: [id, snapshot, Date.now()],
  })
}

export async function loadShortLink(id: string, now: number = Date.now()): Promise<string | null> {
  await ensureSchema()
  const result = await getDb().execute({
    sql: 'SELECT snapshot, created_at FROM short_links WHERE id = ?',
    args: [id],
  })
  const row = result.rows[0] as unknown as { snapshot: string; created_at: number } | undefined
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
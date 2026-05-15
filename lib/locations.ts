import { getDb } from '@/lib/db'

let initPromise: Promise<void> | null = null

export function ensureDbInit(): Promise<void> {
  if (!initPromise) {
    initPromise = getDb()
      .execute(`
        CREATE TABLE IF NOT EXISTS saved_locations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

export async function getSavedLocations() {
  await ensureDbInit()
  const result = await getDb().execute('SELECT * FROM saved_locations ORDER BY created_at DESC')
  return result.rows as unknown as Array<{ id: number; name: string; latitude: number; longitude: number; created_at: string }>
}

export async function saveLocation(name: string, latitude: number, longitude: number) {
  await ensureDbInit()
  const result = await getDb().execute({
    sql: 'INSERT INTO saved_locations (name, latitude, longitude) VALUES (?, ?, ?)',
    args: [name, latitude, longitude],
  })
  return result.lastInsertRowid
}

export async function deleteLocation(id: number) {
  await ensureDbInit()
  await getDb().execute({
    sql: 'DELETE FROM saved_locations WHERE id = ?',
    args: [id],
  })
}

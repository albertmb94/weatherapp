import { createClient, type Client, type InValue } from '@libsql/client'

let cached: Client | null = null
let initialized = false
let available: boolean | null = null

export interface DbAdapter {
  available: boolean
  /**
   * Returns true iff a real (read+write) database is reachable. When
   * false, all cache/persistence callers must short-circuit to their
   * in-memory fallback. The check is cached after the first call so we
   * don't hammer the libsql client on every request.
   */
  ensure(): Promise<boolean>
  /**
   * Run a SELECT and return the rows. Returns an empty array when the DB
   * is unavailable so the route still accepts the request.
   */
  select<T = Record<string, unknown>>(
    sql: string,
    args?: InValue[],
  ): Promise<T[]>
  /**
   * Run a write (INSERT/UPDATE/DELETE/CREATE). Returns true on success,
   * false (without throwing) when the DB is unavailable â€” the caller can
   * then fall back to the in-memory store.
   */
  execute(sql: string, args?: InValue[]): Promise<boolean>
}

function getUnderlyingClient(): Client | null {
  if (initialized) return cached
  initialized = true
  const tursoUrl = process.env.TURSO_DATABASE_URL
  const tursoToken = process.env.TURSO_AUTH_TOKEN
  // B-NBT-10 fix: opt-in para despliegues self-hosted en modo producción
  // SIN Turso (`next start` en un VPS/staging). Sin este flag,
  // NODE_ENV=production anulaba el cliente y TODO el admin quedaba en
  // no-op silencioso (isAdmin siempre false, tablas nunca creadas).
  const allowFileInProd =
    process.env.DB_ALLOW_FILE_IN_PRODUCTION === '1' ||
    process.env.DB_ALLOW_FILE_IN_PRODUCTION === 'true'
  if (process.env.NODE_ENV === 'production' && !tursoUrl && !allowFileInProd) {
    // Vercel functions are read-only so we can't fall back to
    // file:local.db there. Defer to the in-memory adapters.
    cached = null
    return cached
  }
  try {
    cached = createClient({
      url: tursoUrl ?? 'file:local.db',
      authToken: tursoToken,
    })
  } catch {
    cached = null
  }
  return cached
}

export function getDb(): Client | null {
  return getUnderlyingClient()
}

export const db: DbAdapter = {
  get available() {
    return available ?? false
  },
  async ensure(): Promise<boolean> {
    if (available !== null) return available
    const client = getUnderlyingClient()
    if (!client) {
      available = false
      return false
    }
    try {
      await client.execute('SELECT 1')
      available = true
    } catch (err) {
      // B-NBT-10 fix: loguear el motivo y NO cachear el fallo para
      // siempre (un lock transitorio de local.db dejaba al proceso
      // muerto para todo el ciclo de vida).
      console.error('[db] ensure failed:', err instanceof Error ? err.message : err)
      available = null
      return false
    }
    return available
  },
  async select<T = Record<string, unknown>>(sql: string, args?: InValue[]): Promise<T[]> {
    const client = getUnderlyingClient()
    if (!client) return []
    try {
      const result = await client.execute({ sql, args })
      return (result.rows as unknown as T[]) ?? []
    } catch (err) {
      // B-NBT-10: reintentable en la siguiente llamada (antes se
      // deshabilitaba el adaptador para siempre).
      console.error('[db] select failed:', sql.slice(0, 60), err instanceof Error ? err.message : err)
      available = null
      return []
    }
  },
  async execute(sql: string, args?: InValue[]): Promise<boolean> {
    const client = getUnderlyingClient()
    if (!client) return false
    try {
      await client.execute({ sql, args })
      return true
    } catch (err) {
      // B-NBT-10: igual que select — fallo ⇒ reintento en la próxima
      // llamada en vez de muerte permanente del adaptador.
      console.error('[db] execute failed:', sql.slice(0, 60), err instanceof Error ? err.message : err)
      available = null
      return false
    }
  },
}

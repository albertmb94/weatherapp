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
   * false (without throwing) when the DB is unavailable — the caller can
   * then fall back to the in-memory store.
   */
  execute(sql: string, args?: InValue[]): Promise<boolean>
}

function getUnderlyingClient(): Client | null {
  if (initialized) return cached
  initialized = true
  const tursoUrl = process.env.TURSO_DATABASE_URL
  const tursoToken = process.env.TURSO_AUTH_TOKEN
  if (process.env.NODE_ENV === 'production' && !tursoUrl) {
    // No Turso configured in production: Vercel functions are read-only so
    // we can't fall back to file:local.db. Defer to the in-memory adapters.
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
    } catch {
      available = false
    }
    return available
  },
  async select<T = Record<string, unknown>>(sql: string, args?: InValue[]): Promise<T[]> {
    const client = getUnderlyingClient()
    if (!client) return []
    try {
      const result = await client.execute({ sql, args })
      return (result.rows as unknown as T[]) ?? []
    } catch {
      // Once a query fails the SDK may be in a permanent blocked state
      // (we've seen this on Vercel when reads are disabled at the plan
      // level). Mark the adapter unavailable so subsequent calls skip
      // the DB entirely instead of paying round-trip costs.
      available = false
      return []
    }
  },
  async execute(sql: string, args?: InValue[]): Promise<boolean> {
    const client = getUnderlyingClient()
    if (!client) return false
    try {
      await client.execute({ sql, args })
      return true
    } catch {
      available = false
      return false
    }
  },
}

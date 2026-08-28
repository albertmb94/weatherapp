import { createClient, type Client, type InValue } from '@libsql/client'

let cached: Client | null = null
let initialized = false
let available: boolean | null = null

/**
 * Motivo por el que una operación de BD no se pudo completar.
 *
 *  - `not_configured`: no hay cliente que construir. En producción sin
 *    TURSO_DATABASE_URL ni DB_ALLOW_FILE_IN_PRODUCTION, o si
 *    `createClient` lanzó. Es un problema de despliegue, no de datos.
 *  - `query_failed`: había cliente pero la sentencia falló — tabla
 *    inexistente, SQL inválido, corte de red, constraint violada.
 */
export type DbErrorKind = 'not_configured' | 'query_failed'

export class DbError extends Error {
  constructor(
    readonly kind: DbErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'DbError'
  }
}

export interface DbAdapter {
  available: boolean
  /**
   * True si se pudo construir un cliente libsql (env presente o fallback
   * a fichero permitido). Síncrono, sin I/O: distingue "no configurada"
   * de "configurada pero caída" sin esperar a una consulta.
   */
  readonly configured: boolean
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
   *
   * OJO (auditoría #3): este método NO lanza nunca. Un "no such table"
   * es indistinguible de "cero filas". Ese contrato permisivo es
   * deliberado y load-bearing para los cachés (que caen a red) y para
   * los flags/sesiones (que caen a OFF/deslogueado) — pero es veneno
   * para un dashboard, que acaba pintando ceros en vez de un error. Si
   * necesitas distinguirlos, usa `selectOrThrow`.
   */
  select<T = Record<string, unknown>>(
    sql: string,
    args?: InValue[],
  ): Promise<T[]>
  /**
   * Run a write (INSERT/UPDATE/DELETE/CREATE). Returns true on success,
   * false (without throwing) when the DB is unavailable — the caller can
   * then fall back to the in-memory store. Mismo aviso que `select`.
   */
  execute(sql: string, args?: InValue[]): Promise<boolean>

  /** Como `select`, pero lanza `DbError`. Úsalo donde un fallo deba ser
   *  visible (métricas, migraciones, ingesta, health). */
  selectOrThrow<T = Record<string, unknown>>(
    sql: string,
    args?: InValue[],
  ): Promise<T[]>
  /** Como `execute`, pero lanza `DbError`. */
  executeOrThrow(sql: string, args?: InValue[]): Promise<void>
  /** Lote atómico (transacción de escritura). Lanza `DbError`.
   *  Lo usa el runner de migraciones para que el DDL y el registro en
   *  `schema_migrations` caigan juntos o no caigan. */
  batchOrThrow(stmts: { sql: string; args?: InValue[] }[]): Promise<void>
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

function requireClient(): Client {
  const client = getUnderlyingClient()
  if (!client) {
    throw new DbError(
      'not_configured',
      'No hay cliente de base de datos: define TURSO_DATABASE_URL (o DB_ALLOW_FILE_IN_PRODUCTION=1 en self-hosted).',
    )
  }
  return client
}

function wrapQueryError(sql: string, err: unknown): DbError {
  const detail = err instanceof Error ? err.message : String(err)
  return new DbError('query_failed', `${detail} — SQL: ${sql.slice(0, 120)}`, err)
}

export const db: DbAdapter = {
  get available() {
    return available ?? false
  },
  get configured() {
    return getUnderlyingClient() !== null
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

  // --- variantes estrictas: la única implementación real ---

  async selectOrThrow<T = Record<string, unknown>>(sql: string, args?: InValue[]): Promise<T[]> {
    const client = requireClient()
    try {
      const result = await client.execute({ sql, args })
      return (result.rows as unknown as T[]) ?? []
    } catch (err) {
      throw wrapQueryError(sql, err)
    }
  },
  async executeOrThrow(sql: string, args?: InValue[]): Promise<void> {
    const client = requireClient()
    try {
      await client.execute({ sql, args })
    } catch (err) {
      throw wrapQueryError(sql, err)
    }
  },
  async batchOrThrow(stmts: { sql: string; args?: InValue[] }[]): Promise<void> {
    const client = requireClient()
    if (stmts.length === 0) return
    try {
      await client.batch(stmts.map(s => ({ sql: s.sql, args: s.args ?? [] })), 'write')
    } catch (err) {
      throw wrapQueryError(stmts[0]?.sql ?? '(lote vacío)', err)
    }
  },

  // --- variantes permisivas: wrappers de las estrictas, para que haya
  //     un solo camino de ejecución y no puedan divergir ---

  async select<T = Record<string, unknown>>(sql: string, args?: InValue[]): Promise<T[]> {
    try {
      return await db.selectOrThrow<T>(sql, args)
    } catch (err) {
      if (err instanceof DbError && err.kind === 'not_configured') return []
      console.error('[db] select failed:', sql.slice(0, 60), err instanceof Error ? err.message : err)
      // B-NBT-10: reintentable en la siguiente llamada (antes se
      // deshabilitaba el adaptador para siempre).
      available = null
      return []
    }
  },
  async execute(sql: string, args?: InValue[]): Promise<boolean> {
    try {
      await db.executeOrThrow(sql, args)
      return true
    } catch (err) {
      if (err instanceof DbError && err.kind === 'not_configured') return false
      // B-NBT-10: igual que select — fallo ⇒ reintento en la próxima
      // llamada en vez de muerte permanente del adaptador.
      console.error('[db] execute failed:', sql.slice(0, 60), err instanceof Error ? err.message : err)
      available = null
      return false
    }
  },
}

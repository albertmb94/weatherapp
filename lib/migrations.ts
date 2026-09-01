/**
 * Migraciones versionadas.
 *
 * ANTES no existía ninguna. El esquema de analytics se creaba con
 * `CREATE TABLE IF NOT EXISTS` dentro de la ruta de ingesta, en la
 * primera petición aceptada de cada instancia, y la única "migración"
 * real del proyecto era un `ALTER TABLE page_views ADD COLUMN geo_cell`
 * envuelto en try/catch que se reintentaba en cada arranque en frío. Eso
 * produce dos problemas graves:
 *
 *   1. El camino de LECTURA (el panel de métricas) nunca creaba las
 *      tablas que lee. Si la ingesta no había corrido en esa base de
 *      datos — que es exactamente lo que pasaba, porque el gate de
 *      consentimiento estaba cerrado — `SELECT ... FROM page_views`
 *      fallaba con "no such table", `db.select` se tragaba el error
 *      devolviendo `[]`, y el dashboard pintaba ceros.
 *   2. No había forma de saber en qué estado estaba una base de datos.
 *      `scripts/turso-migration.sql` no contenía ni una tabla de
 *      analytics.
 *
 * ALCANCE ACTUAL — leer antes de asumir de más:
 * esta lista cubre el subsistema de ANALYTICS. Los demás módulos
 * (features, entitlements, plans, emails, affiliate, appState,
 * cacheStore, externalStationsCache, newsletter, shortLinks, admin,
 * backtest) siguen creando su esquema de forma perezosa con
 * `memoizeSchema()` porque cada uno lleva lógica de seeding entrelazada
 * con su DDL (credenciales desde ADMIN_PASSWORD, catálogo de flags,
 * nombres de tabla parametrizados...). Migrarlos es un PR por módulo.
 * Por tanto `schema_migrations` NO describe todavía la base de datos
 * completa.
 *
 * CÓMO SE APLICAN: desde `instrumentation.ts` al arrancar el proceso
 * Node, sin bloquear la primera petición, y los caminos de lectura y
 * escritura de analytics esperan la MISMA promesa memoizada
 * (`migrationsReady()`). También manualmente con `npm run migrate` y
 * desde `/api/admin/migrate`.
 */

import { createHash } from 'crypto'
import { db, DbError } from './db'

export interface Migration {
  version: number
  name: string
  /** DDL declarativo. Se aplica en lote atómico junto con el registro
   *  en `schema_migrations`. */
  statements?: string[]
  /** Escape para lo que no se puede expresar como DDL fijo (p. ej.
   *  ALTER condicionado a PRAGMA table_info). Se ejecuta ANTES de
   *  registrar la versión, pero no comparte transacción con ella: debe
   *  ser idempotente. */
  apply?: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Utilidades para migraciones no declarativas
// ---------------------------------------------------------------------------

/** SQLite no tiene `ADD COLUMN IF NOT EXISTS`, y la base de datos viva
 *  ya tiene columnas añadidas a mano en el pasado. */
async function hasColumn(table: string, column: string): Promise<boolean> {
  // PRAGMA no admite parámetros enlazados; `table` es siempre un literal
  // de este fichero, nunca entrada de usuario.
  const rows = await db.selectOrThrow<{ name: string }>(`PRAGMA table_info(${table})`)
  return rows.some(r => String(r.name) === column)
}

async function addColumnIfMissing(table: string, column: string, decl: string): Promise<void> {
  if (await hasColumn(table, column)) return
  await db.executeOrThrow(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`)
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'analytics_baseline',
    // DDL idéntico al que creaba app/api/track/pageview/route.ts, para
    // que sea un no-op exacto sobre la base de datos que ya está viva.
    statements: [
      `CREATE TABLE IF NOT EXISTS page_views (
        id TEXT PRIMARY KEY,
        anon_id TEXT NOT NULL,
        path TEXT NOT NULL,
        referrer TEXT,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        country TEXT,
        locale TEXT,
        user_agent_browser TEXT,
        user_agent_os TEXT,
        device_type TEXT,
        ts INTEGER NOT NULL,
        duration_ms INTEGER,
        session_id TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_pv_ts ON page_views(ts)`,
      `CREATE INDEX IF NOT EXISTS idx_pv_anon ON page_views(anon_id, ts)`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        anon_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        page_count INTEGER DEFAULT 0,
        country TEXT,
        device_type TEXT,
        locale TEXT,
        entry_path TEXT,
        exit_path TEXT,
        is_bounce INTEGER DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sess_anon ON sessions(anon_id, started_at)`,
    ],
  },
  {
    version: 2,
    name: 'analytics_rollup',
    statements: [
      `CREATE TABLE IF NOT EXISTS daily_anon_stats (
        date TEXT NOT NULL,
        anon_id TEXT NOT NULL,
        views INTEGER NOT NULL DEFAULT 0,
        sessions INTEGER NOT NULL DEFAULT 0,
        is_new INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, anon_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_das_date ON daily_anon_stats(date)`,
      `CREATE TABLE IF NOT EXISTS visitor_identity (
        anon_id TEXT PRIMARY KEY,
        email TEXT,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_vi_email ON visitor_identity(email)`,
      // Antes se creaba dentro de resolveZoneNames(), es decir: DDL en un
      // camino de solo-lectura, durante el render del panel.
      `CREATE TABLE IF NOT EXISTS geo_names (
        cell TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ],
  },
  {
    version: 3,
    name: 'analytics_events',
    // Esta tabla NUNCA llegó a existir: la ruta que la creaba no tenía
    // ni un solo llamador en todo el repo.
    statements: [
      `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        anon_id TEXT NOT NULL,
        session_id TEXT,
        name TEXT NOT NULL,
        properties TEXT,
        ts INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_events_name ON events(name, ts)`,
      `CREATE INDEX IF NOT EXISTS idx_events_anon ON events(anon_id, ts)`,
      `CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)`,
    ],
  },
  {
    version: 4,
    name: 'analytics_day_and_geo_columns',
    /**
     * Columnas nuevas sobre tablas que ya pueden existir con historia.
     * Las claves `day` son la pieza central del arreglo de zona horaria:
     * el día de calendario se resuelve en Europe/Madrid al insertar, en
     * vez de con `strftime(...,'unixepoch')`, que es UTC y no acepta
     * zona.
     */
    apply: async () => {
      await addColumnIfMissing('page_views', 'geo_cell', 'TEXT')
      await addColumnIfMissing('page_views', 'day', 'TEXT')
      await addColumnIfMissing('page_views', 'country_code', 'TEXT')
      await addColumnIfMissing('sessions', 'started_day', 'TEXT')
      await addColumnIfMissing('visitor_identity', 'first_seen_day', 'TEXT')

      await db.executeOrThrow(`CREATE INDEX IF NOT EXISTS idx_pv_geo ON page_views(geo_cell, ts)`)
      await db.executeOrThrow(`CREATE INDEX IF NOT EXISTS idx_pv_day ON page_views(day)`)
      await db.executeOrThrow(`CREATE INDEX IF NOT EXISTS idx_pv_day_anon ON page_views(day, anon_id)`)
      await db.executeOrThrow(`CREATE INDEX IF NOT EXISTS idx_sess_started_day ON sessions(started_day)`)
      await db.executeOrThrow(`CREATE INDEX IF NOT EXISTS idx_vi_first_day ON visitor_identity(first_seen_day)`)

      // Relleno de las filas históricas. Se hace con strftime, es decir
      // en UTC: para datos antiguos es una aproximación (las visitas
      // entre medianoche y las 01:00/02:00 locales quedan en el día
      // anterior). No es recuperable de otra forma y sólo afecta al
      // histórico; a partir de aquí `day` se escribe ya resuelto en
      // hora de Madrid.
      await db.executeOrThrow(
        `UPDATE page_views SET day = strftime('%Y-%m-%d', ts / 1000, 'unixepoch') WHERE day IS NULL`,
      )
      await db.executeOrThrow(
        `UPDATE sessions SET started_day = strftime('%Y-%m-%d', started_at / 1000, 'unixepoch') WHERE started_day IS NULL`,
      )
      await db.executeOrThrow(
        `UPDATE visitor_identity SET first_seen_day = strftime('%Y-%m-%d', first_seen_at / 1000, 'unixepoch') WHERE first_seen_day IS NULL`,
      )
    },
  },
  {
    version: 5,
    name: 'analytics_breakdowns',
    /**
     * Desgloses diarios preagregados. `daily_anon_stats` sólo puede
     * servir la serie y los KPI de dispositivos únicos; sin esta tabla,
     * el rollup no puede alimentar las tarjetas de páginas, referentes,
     * dispositivos, navegadores, país, idioma ni zonas, y el panel se
     * ve obligado a consultar `page_views` en crudo sobre toda la
     * ventana.
     *
     * `devices` es el distinto POR DÍA: sumarlo entre días sobrecuenta
     * (un visitante que entra 5 días cuenta 5 veces). Por eso las
     * tarjetas de desglose muestran vistas, y los únicos de rango salen
     * de `daily_anon_stats`, donde hay una fila por anon y día y el
     * COUNT(DISTINCT) entre días sí es exacto.
     */
    statements: [
      `CREATE TABLE IF NOT EXISTS daily_breakdowns (
        date TEXT NOT NULL,
        dim TEXT NOT NULL,
        label TEXT NOT NULL,
        views INTEGER NOT NULL DEFAULT 0,
        devices INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, dim, label)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_db_date_dim ON daily_breakdowns(date, dim)`,
    ],
  },
  {
    version: 6,
    name: 'backfill_visitor_identity',
    /**
     * Reconstruye `visitor_identity` a partir de `page_views`.
     *
     * La tabla estaba VACÍA en producción pese a escribirse en cada
     * pageview: `touchVisitorIdentity` no arrancaba su esquema y su
     * try/catch se comía el "no such table". Consecuencias: la columna
     * lastSeen del listado de usuarios del admin llevaba null para todo
     * el mundo, y sin `first_seen_day` ningún dispositivo del histórico
     * puede contarse como nuevo (el panel los daba todos por
     * recurrentes).
     *
     * La primera visión se reconstruye con MIN(ts), que es lo mejor
     * disponible: para dispositivos cuyo histórico ya se purgó será
     * posterior a la real. Sólo afecta a los datos previos a esta
     * migración; a partir de aquí la escribe la ingesta.
     */
    apply: async () => {
      await db.executeOrThrow(
        `INSERT OR IGNORE INTO visitor_identity (anon_id, first_seen_at, first_seen_day, last_seen_at)
         SELECT anon_id, MIN(ts), MIN(day), MAX(ts) FROM page_views GROUP BY anon_id`,
      )
      // Para las filas que ya existían pero sin día resuelto.
      await db.executeOrThrow(
        `UPDATE visitor_identity SET first_seen_day = (
           SELECT MIN(pv.day) FROM page_views pv WHERE pv.anon_id = visitor_identity.anon_id
         ) WHERE first_seen_day IS NULL`,
      )
    },
  },
  {
    version: 7,
    name: 'consent_stats',
    /**
     * Tasa de aceptación del banner de consentimiento.
     *
     * NO HAY IDENTIFICADOR AQUÍ, Y ES LA RAZÓN DE SER DEL DISEÑO. Medir
     * esto obliga a contar a gente que TODAVÍA NO HA CONSENTIDO, así que
     * no puede haber cookie, ni anon_id, ni IP guardada: sólo un contador
     * agregado por día y tipo de evento. Sin almacenar ni leer nada en el
     * dispositivo y sin ningún identificador, esto no es dato personal y
     * no depende del consentimiento que precisamente está midiendo.
     *
     * `shown` cuenta IMPRESIONES, no personas: el banner reaparece en
     * cada carga hasta que se responde. La tasa es aceptaciones por
     * impresión, y el panel lo etiqueta así — llamarlo "% de visitantes"
     * sería inventarse un denominador que no existe.
     */
    statements: [
      `CREATE TABLE IF NOT EXISTS consent_stats (
        day TEXT NOT NULL,
        event TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, event)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_consent_stats_day ON consent_stats(day)`,
    ],
  },
  {
    version: 8,
    name: 'client_errors',
    /**
     * Errores de JavaScript que rompen la interfaz en el navegador.
     *
     * POR QUÉ EXISTE ESTA TABLA. Hasta ahora la única captura de errores
     * de cliente era `console.error` — es decir, en la consola de la
     * persona afectada, donde nadie la ve. Un fallo que reventara la
     * portada al 30% de los visitantes era invisible hasta que alguien
     * se quejara, y eso es literalmente lo que pasó con la hidratación y
     * con el seguimiento. `instrumentation.ts` tenía Sentry cableado,
     * pero el paquete no estaba instalado y el cableado sólo cubría el
     * servidor: esta app vive en el cliente.
     *
     * QUÉ SE GUARDA Y QUÉ NO. Sólo lo necesario para arreglar el fallo:
     * mensaje, pila, ruta (SIN query, que puede llevar coordenadas) y un
     * recuento. NO se guarda IP, ni identificador, ni user-agent
     * completo. Se agrupa por huella para que un error que le pasa a
     * mil personas sea UNA fila con contador, no mil filas.
     *
     * La huella es hash(mensaje + primera línea de pila): sin ella, un
     * error en bucle llenaría la tabla en minutos.
     */
    statements: [
      `CREATE TABLE IF NOT EXISTS client_errors (
        fingerprint TEXT PRIMARY KEY,
        message TEXT NOT NULL,
        stack TEXT,
        path TEXT,
        count INTEGER NOT NULL DEFAULT 0,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_client_errors_last_seen ON client_errors(last_seen)`,
    ],
  },
]

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const TRACKING_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  checksum TEXT NOT NULL
)`

export interface MigrationResult {
  ok: boolean
  /** Versión máxima aplicada tras esta ejecución. */
  currentVersion: number
  /** Versión máxima que conoce el código. */
  latestVersion: number
  applied: number[]
  pending: number[]
  /** Migraciones ya aplicadas cuyo SQL ha cambiado desde entonces. */
  drift: { version: number; name: string }[]
  error?: string
  errorKind?: 'not_configured' | 'query_failed' | 'unknown'
}

export function checksum(m: Migration): string {
  const payload = m.apply ? `apply:${m.name}` : (m.statements ?? []).join('\n')
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

export const latestVersion = (): number =>
  MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0)

let ready: Promise<MigrationResult> | null = null
let lastFailureAt = 0
const FAILURE_BACKOFF_MS = 30_000

/**
 * Promesa memoizada compartida por todos los llamadores.
 *
 * Sólo se cachea el ÉXITO. Tras un fallo se libera el memo, pero con
 * ventana de espera: sin ella, una caída de Turso haría que cada
 * petición reintentase la secuencia completa de DDL contra una base de
 * datos que ya está sufriendo.
 */
export function migrationsReady(): Promise<MigrationResult> {
  if (ready) return ready
  const since = Date.now() - lastFailureAt
  if (lastFailureAt > 0 && since < FAILURE_BACKOFF_MS) {
    return Promise.resolve({
      ok: false,
      currentVersion: -1,
      latestVersion: latestVersion(),
      applied: [],
      pending: [],
      drift: [],
      error: `en espera tras un fallo reciente (${Math.round((FAILURE_BACKOFF_MS - since) / 1000)}s)`,
      errorKind: 'unknown',
    })
  }
  ready = runMigrations().then(res => {
    if (!res.ok) {
      ready = null
      lastFailureAt = Date.now()
    } else {
      lastFailureAt = 0
    }
    return res
  })
  return ready
}

/** Fuerza una ejecución ignorando el memo (lo usa /api/admin/migrate). */
export function resetMigrationsMemo(): void {
  ready = null
  lastFailureAt = 0
}

/** Estado actual sin aplicar nada. */
export async function migrationStatus(): Promise<MigrationResult> {
  const base: MigrationResult = {
    ok: false,
    currentVersion: -1,
    latestVersion: latestVersion(),
    applied: [],
    pending: [],
    drift: [],
  }
  try {
    await db.executeOrThrow(TRACKING_TABLE)
    const rows = await db.selectOrThrow<{ version: number; checksum: string; name: string }>(
      'SELECT version, name, checksum FROM schema_migrations',
    )
    const byVersion = new Map(rows.map(r => [Number(r.version), r]))
    const drift: { version: number; name: string }[] = []
    for (const m of MIGRATIONS) {
      const row = byVersion.get(m.version)
      if (row && String(row.checksum) !== checksum(m)) drift.push({ version: m.version, name: m.name })
    }
    return {
      ...base,
      ok: true,
      currentVersion: rows.reduce((max, r) => Math.max(max, Number(r.version)), 0),
      applied: [...byVersion.keys()].sort((a, b) => a - b),
      pending: MIGRATIONS.filter(m => !byVersion.has(m.version)).map(m => m.version),
      drift,
    }
  } catch (err) {
    return { ...base, ...describeError(err) }
  }
}

function describeError(err: unknown): Pick<MigrationResult, 'error' | 'errorKind'> {
  if (err instanceof DbError) return { error: err.message, errorKind: err.kind }
  return { error: err instanceof Error ? err.message : String(err), errorKind: 'unknown' }
}

export async function runMigrations(): Promise<MigrationResult> {
  const result: MigrationResult = {
    ok: false,
    currentVersion: -1,
    latestVersion: latestVersion(),
    applied: [],
    pending: [],
    drift: [],
  }

  try {
    await db.executeOrThrow(TRACKING_TABLE)

    const rows = await db.selectOrThrow<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    )
    const done = new Map(rows.map(r => [Number(r.version), String(r.checksum)]))

    // Deriva: alguien editó el SQL de una migración ya aplicada. Se avisa
    // MUY alto pero no se aborta: fallar en cerrado por una errata en un
    // comentario tumbaría el sitio entero.
    for (const m of MIGRATIONS) {
      const prev = done.get(m.version)
      if (prev !== undefined && prev !== checksum(m)) {
        result.drift.push({ version: m.version, name: m.name })
        console.warn(
          `[migrations] DERIVA en v${m.version} (${m.name}): el SQL ha cambiado desde que se aplicó. ` +
            'La base de datos NO se toca. Crea una migración nueva en vez de editar una ya aplicada.',
        )
      }
    }

    const pending = MIGRATIONS.filter(m => !done.has(m.version)).sort((a, b) => a.version - b.version)
    result.pending = pending.map(m => m.version)

    for (const m of pending) {
      const record = {
        sql: 'INSERT OR IGNORE INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
        // INSERT OR IGNORE y no INSERT: dos lambdas pueden arrancar en
        // frío a la vez y competir por la misma versión.
        args: [m.version, m.name, Date.now(), checksum(m)] as (string | number)[],
      }
      if (m.apply) {
        // No se puede meter en el lote: `apply` decide qué ejecutar
        // consultando la base de datos. Debe ser idempotente.
        await m.apply()
        await db.executeOrThrow(record.sql, record.args)
      } else {
        // DDL y registro en la MISMA transacción: si el lote falla, la
        // versión no queda marcada como aplicada.
        await db.batchOrThrow([
          ...(m.statements ?? []).map(sql => ({ sql })),
          record,
        ])
      }
      result.applied.push(m.version)
      // Aplicar una migración es un cambio de esquema en producción: debe
      // quedar en el log aunque no sea un error.
      // eslint-disable-next-line no-console
      console.log(`[migrations] aplicada v${m.version} ${m.name}`)
    }

    result.currentVersion = Math.max(
      0,
      ...[...done.keys(), ...result.applied],
    )
    result.pending = []
    result.ok = true
    return result
  } catch (err) {
    const described = describeError(err)
    console.error(`[migrations] fallo: ${described.error}`)
    return { ...result, ...described }
  }
}

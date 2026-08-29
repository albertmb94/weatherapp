/**
 * Capa de agregación de analytics para el panel de administración.
 *
 * QUÉ CAMBIÓ RESPECTO A LA VERSIÓN ANTERIOR (auditoría):
 *
 *  1. `getAdminMetrics` devolvía `AdminMetrics | null`, pero como
 *     `db.select` NUNCA lanza (devuelve `[]` y traga el error), su
 *     try/catch no podía dispararse: una tabla inexistente producía un
 *     objeto lleno de ceros, indistinguible de un martes tranquilo. Por
 *     eso el incidente pasó desapercibido. Ahora usa las variantes
 *     estrictas y devuelve una unión discriminada que el panel puede
 *     pintar como error de verdad.
 *
 *  2. `ensureAnalyticsSchema()` creaba `daily_anon_stats` y
 *     `visitor_identity`... pero NO `page_views` ni `sessions`, que son
 *     las que consultaba. Esas sólo las creaba la ruta de ingesta. Ahora
 *     el esquema lo gobierna lib/migrations.ts.
 *
 *  3. El rollup escribía `daily_anon_stats` y NO LO LEÍA NADIE:
 *     `getAdminMetrics` iba siempre contra `page_views` en crudo. Ahora
 *     es híbrido — días cerrados desde el rollup, hoy desde crudo — con
 *     lo que el trabajo nocturno por fin sirve para algo y desaparece el
 *     COUNT(DISTINCT) sobre 90 días de filas crudas.
 *
 *  4. El purge de retención se ejecutaba SIEMPRE, incluso si el rollup
 *     había fallado en silencio. Era el único fallo con pérdida de datos
 *     irreversible del sistema. Ahora el borrado está condicionado a que
 *     la consolidación se verifique.
 *
 *  5. `resolveZoneNames` hacía hasta 5 fetch bloqueantes de 4 s a un
 *     servicio externo DENTRO del render del panel, y además creaba una
 *     tabla en un camino de sólo lectura. Se ha partido en una lectura
 *     pura y un trabajo nocturno.
 *
 *  6. Los días se agrupaban con `strftime(...,'unixepoch')`, que es UTC.
 *     Ahora se usa la columna `day`, resuelta en Europe/Madrid al
 *     insertar.
 */

import { db, DbError } from './db'
import { migrationsReady } from './migrations'
import { celdaValida, coordenadasDe } from './analytics/geoCell'
import { dayKey, todayKey, rangeDayKeys, prevDayKey, dayStartMs, MS_PER_DAY } from './analytics/time'

const RETENTION_DAYS = 90
/** La identidad anónima vive lo que la cookie (2 años). Sin este purgado
 *  `visitor_identity` crecía para siempre: coste y problema de retención. */
const IDENTITY_RETENTION_DAYS = 730

export const ALLOWED_RANGES = [7, 30, 90] as const
export type RangeDays = (typeof ALLOWED_RANGES)[number]

export function parseRange(value: string | null | undefined): RangeDays {
  const n = Number(value)
  return (ALLOWED_RANGES as readonly number[]).includes(n) ? (n as RangeDays) : 30
}

/** Dimensiones preagregadas en `daily_breakdowns`. */
export const BREAKDOWN_DIMS = [
  'path',
  'referrer',
  'utm_source',
  'device',
  'browser',
  'country',
  'locale',
  'geo_cell',
] as const
export type BreakdownDim = (typeof BREAKDOWN_DIMS)[number]

// ---------------------------------------------------------------------------
// Identidad del visitante
// ---------------------------------------------------------------------------

/**
 * Se llama en cada pageview aceptado. `first_seen_at` / `first_seen_day`
 * son insert-only: el ON CONFLICT no los toca.
 *
 * Esta tabla estaba VACÍA en producción pese a escribirse en cada
 * pageview: la función no arrancaba el esquema y su try/catch se comía
 * el "no such table", así que la columna lastSeen del listado de
 * usuarios del admin llevaba null para todo el mundo desde siempre.
 */
export async function touchVisitorIdentity(anonId: string, now = Date.now()): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO visitor_identity (anon_id, first_seen_at, first_seen_day, last_seen_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(anon_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      [anonId, now, dayKey(now), now],
    )
  } catch {
    /* best-effort */
  }
}

/** Enlaza un dispositivo con un email en el único momento en que se
 *  conocen juntos (reclamación de premium). */
export async function linkVisitorIdentity(anonId: string, email: string, now = Date.now()): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO visitor_identity (anon_id, email, first_seen_at, first_seen_day, last_seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(anon_id) DO UPDATE SET
         email = excluded.email,
         last_seen_at = excluded.last_seen_at`,
      [anonId, email.toLowerCase(), now, dayKey(now), now],
    )
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Tipos del panel
// ---------------------------------------------------------------------------

export interface DailyPoint {
  date: string // YYYY-MM-DD (Europe/Madrid)
  devices: number
  views: number
  newDevices: number
}

export interface BreakdownRow {
  label: string
  /** VISTAS, no dispositivos únicos. Ver la nota de `mergeBreakdown`. */
  count: number
}

export interface AdminMetrics {
  rangeDays: number
  today: { devices: number; views: number }
  yesterday: { devices: number; views: number }
  weekDevices: number
  /** Dispositivos distintos en toda la ventana. */
  rangeDevices: number
  /** rangeNew + rangeReturning === rangeDevices, exactamente. */
  rangeNew: number
  rangeReturning: number
  series: DailyPoint[]
  topPaths: BreakdownRow[]
  referrers: BreakdownRow[]
  utmSources: BreakdownRow[]
  devices: BreakdownRow[]
  browsers: BreakdownRow[]
  countries: BreakdownRow[]
  locales: BreakdownRow[]
  zones: { label: string; views: number }[]
  sessionsToday: number
  sessionsRange: number
  viewsPerSession: number | null
  bounceRate: number | null
  /** Avisos no fatales: la página pinta datos reales y un banner. */
  warnings: string[]
  generatedAt: number
}

export type MetricsResult =
  | { ok: true; metrics: AdminMetrics }
  | { ok: false; error: 'not_configured' | 'query_failed' | 'schema_pending'; detail?: string }

// ---------------------------------------------------------------------------
// Nombres de zona
// ---------------------------------------------------------------------------

const geoNameCache = new Map<string, string>()

/**
 * Lectura PURA: sólo consulta la tabla y la caché en memoria. Las celdas
 * sin resolver se muestran como coordenadas.
 *
 * La versión anterior hacía aquí mismo hasta 5 `fetch` secuenciales de 4 s
 * de timeout contra un servicio externo, dentro del render del server
 * component — hasta 20 s de TTFB en el panel — y encima ejecutaba un
 * CREATE TABLE en un camino de sólo lectura.
 */
async function lookupZoneNames(cells: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const missing: string[] = []
  for (const cell of cells) {
    const cached = geoNameCache.get(cell)
    if (cached) out.set(cell, cached)
    else missing.push(cell)
  }
  if (missing.length > 0) {
    const placeholders = missing.map(() => '?').join(',')
    const rows = await db.selectOrThrow<{ cell: string; name: string }>(
      `SELECT cell, name FROM geo_names WHERE cell IN (${placeholders})`,
      missing,
    )
    for (const r of rows) {
      const name = String(r.name)
      geoNameCache.set(String(r.cell), name)
      out.set(String(r.cell), name)
    }
  }
  for (const cell of cells) if (!out.has(cell)) out.set(cell, cell)
  return out
}

/**
 * Escritura: resuelve nombres pendientes contra BigDataCloud. Se ejecuta
 * en el cron nocturno, con presupuesto acotado y fuera del camino de
 * petición.
 */
export async function resolveZoneName(cell: string): Promise<string | null> {
  const coords = coordenadasDe(cell)
  if (!coords) return null
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${coords.lat}&longitude=${coords.lon}&localityLanguage=es`,
      { signal: AbortSignal.timeout(4000) },
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      city?: string
      locality?: string
      principalSubdivision?: string
      countryName?: string
    }
    const name =
      [data.city || data.locality, data.principalSubdivision].filter(Boolean).join(' · ') ||
      data.countryName ||
      cell
    await db.executeOrThrow(
      'INSERT OR REPLACE INTO geo_names (cell, name, created_at) VALUES (?, ?, ?)',
      [cell, name, Date.now()],
    )
    geoNameCache.set(cell, name)
    return name
  } catch {
    // timeout/red: no se cachea nada, así que se reintentará.
    return null
  }
}

/**
 * Resuelve una lista CONCRETA de celdas, saltándose las que ya tienen
 * nombre. Es lo que usa el panel para nombrar en el acto lo que acaba de
 * pintar; el cron sigue existiendo como red de seguridad.
 */
export async function resolveZoneNames(
  cells: string[],
  limit = 12,
): Promise<Record<string, string>> {
  const candidatas = [...new Set(cells)].filter(c => celdaValida(c)).slice(0, limit)
  if (candidatas.length === 0) return {}

  // Las que ya están nombradas no se vuelven a pedir: `geo_names` es
  // caché permanente, cada celda se resuelve UNA vez en su vida.
  const marcadores = candidatas.map(() => '?').join(',')
  const yaEstan = await db.selectOrThrow<{ cell: string }>(
    `SELECT cell FROM geo_names WHERE cell IN (${marcadores})`,
    candidatas,
  )
  const conocidas = new Set(yaEstan.map(r => String(r.cell)))

  const out: Record<string, string> = {}
  for (const cell of candidatas) {
    if (conocidas.has(cell)) continue
    const name = await resolveZoneName(cell)
    if (name) out[cell] = name
  }
  return out
}

export async function resolveMissingZoneNames(limit = 20): Promise<number> {
  const rows = await db.selectOrThrow<{ label: string }>(
    `SELECT b.label AS label
     FROM daily_breakdowns b
     LEFT JOIN geo_names g ON g.cell = b.label
     WHERE b.dim = 'geo_cell' AND g.cell IS NULL
     GROUP BY b.label
     ORDER BY SUM(b.views) DESC
     LIMIT ?`,
    [limit],
  )
  let resolved = 0
  for (const row of rows) {
    // Mismo código que el camino del panel: si diverge, una vía nombraría
    // las zonas distinto que la otra.
    if (await resolveZoneName(String(row.label))) resolved++
  }
  return resolved
}

export interface ConsentStats {
  /** Veces que se PINTÓ el banner. No son personas: ver abajo. */
  impresiones: number
  aceptadas: number
  rechazadas: number
  /** Impresiones sin respuesta: se ignoró el banner o se abandonó. */
  ignoradas: number
  /**
   * Aceptadas / impresiones, en tanto por uno. `null` sin impresiones.
   *
   * ES POR IMPRESIÓN, NO POR PERSONA, y la diferencia no es menor: el
   * banner reaparece en cada carga hasta que se responde, así que quien
   * lo ignora tres veces cuenta tres. No hay forma de deduplicar sin un
   * identificador, y usar uno aquí sería seguir a quien no ha consentido
   * — justo lo que el banner existe para evitar. El panel lo etiqueta
   * como "por impresión" para que nadie lo lea como "% de visitantes".
   */
  tasa: number | null
}

/** Tasa de aceptación del banner en la ventana pedida. */
export async function getConsentStats(
  rangeDays: number,
  now: number = Date.now(),
): Promise<ConsentStats | null> {
  const desde = rangeDayKeys(rangeDays, now)[0]
  try {
    const filas = await db.selectOrThrow<{ event: string; total: number }>(
      `SELECT event, SUM(count) AS total FROM consent_stats WHERE day >= ? GROUP BY event`,
      [desde],
    )
    const por = new Map(filas.map(f => [String(f.event), toNum(f.total)]))
    const impresiones = por.get('shown') ?? 0
    const aceptadas = por.get('accept') ?? 0
    const rechazadas = por.get('reject') ?? 0
    return {
      impresiones,
      aceptadas,
      rechazadas,
      // Nunca negativo: una respuesta puede llegar sin su impresión si la
      // pestaña se recarga entre medias.
      ignoradas: Math.max(0, impresiones - aceptadas - rechazadas),
      tasa: impresiones > 0 ? aceptadas / impresiones : null,
    }
  } catch {
    // La tabla puede no existir todavía en un despliegue a medias. El
    // resto del panel es válido: se devuelve null y no se pinta la
    // tarjeta, en vez de tumbar la página entera.
    return null
  }
}

// ---------------------------------------------------------------------------
// Lectura del panel
// ---------------------------------------------------------------------------

function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Fusiona los desgloses de días cerrados (rollup) con los de hoy (crudo).
 *
 * Se suman VISTAS y no dispositivos: `daily_breakdowns.devices` es el
 * distinto POR DÍA, y sumarlo entre días sobrecuenta (quien entra 5 días
 * contaría 5 veces). Las vistas sí son aditivas. Por eso las tarjetas de
 * desglose muestran vistas, y los únicos de rango se calculan aparte
 * sobre `daily_anon_stats`, donde hay una fila por dispositivo y día y el
 * COUNT(DISTINCT) entre días sí es exacto.
 *
 * El panel anterior etiquetaba cinco tarjetas como "(únicos)" para
 * números que nunca fueron distintos en el rango.
 */
function mergeBreakdown(
  rows: { dim: string; label: string; views: number }[],
  dim: BreakdownDim,
  limit = 8,
): BreakdownRow[] {
  const acc = new Map<string, number>()
  for (const r of rows) {
    if (r.dim !== dim) continue
    const label = String(r.label ?? '')
    acc.set(label, (acc.get(label) ?? 0) + toNum(r.views))
  }
  // La etiqueta vacía significa cosas distintas según la dimensión: en
  // referentes es tráfico directo, en navegador o país es simplemente un
  // dato que no tenemos. Etiquetarlo todo como "(directo)" hacía que la
  // tarjeta de navegadores mostrara una fila "(directo)" sin sentido.
  const vacio = dim === 'referrer' ? '(directo)' : '(desconocido)'
  return [...acc.entries()]
    .map(([label, count]) => ({ label: label || vacio, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

/** Desgloses de HOY calculados en crudo, con la misma forma que el rollup. */
const TODAY_BREAKDOWN_SQL = `
  SELECT 'path' AS dim, path AS label, COUNT(*) AS views FROM page_views WHERE day = ?1 GROUP BY path
  UNION ALL SELECT 'referrer', COALESCE(referrer, ''), COUNT(*) FROM page_views WHERE day = ?1 GROUP BY referrer
  UNION ALL SELECT 'utm_source', utm_source, COUNT(*) FROM page_views WHERE day = ?1 AND utm_source IS NOT NULL GROUP BY utm_source
  UNION ALL SELECT 'device', COALESCE(device_type, ''), COUNT(*) FROM page_views WHERE day = ?1 GROUP BY device_type
  UNION ALL SELECT 'browser', COALESCE(user_agent_browser, ''), COUNT(*) FROM page_views WHERE day = ?1 GROUP BY user_agent_browser
  UNION ALL SELECT 'country', COALESCE(country_code, ''), COUNT(*) FROM page_views WHERE day = ?1 GROUP BY country_code
  UNION ALL SELECT 'locale', COALESCE(locale, ''), COUNT(*) FROM page_views WHERE day = ?1 GROUP BY locale
  UNION ALL SELECT 'geo_cell', geo_cell, COUNT(*) FROM page_views WHERE day = ?1 AND geo_cell IS NOT NULL GROUP BY geo_cell
`

export async function getAdminMetrics(
  rangeDays: RangeDays = 30,
  now = Date.now(),
): Promise<MetricsResult> {
  const migrations = await migrationsReady()
  if (!migrations.ok) {
    return {
      ok: false,
      error: migrations.errorKind === 'not_configured' ? 'not_configured' : 'schema_pending',
      detail: migrations.error,
    }
  }

  const warnings: string[] = []
  const days = rangeDayKeys(rangeDays, now)
  const today = todayKey(now)
  const yesterday = prevDayKey(today)
  const from = days[0]
  const weekFrom = days[Math.max(0, days.length - 7)]

  try {
    // --- serie diaria: días cerrados desde el rollup, hoy desde crudo ---
    const [rolled, todayAgg] = await Promise.all([
      db.selectOrThrow<{ d: string; views: number; devices: number }>(
        `SELECT date AS d, SUM(views) AS views, COUNT(DISTINCT anon_id) AS devices
         FROM daily_anon_stats WHERE date >= ? AND date < ? GROUP BY date`,
        [from, today],
      ),
      db.selectOrThrow<{ d: string; views: number; devices: number }>(
        `SELECT day AS d, COUNT(*) AS views, COUNT(DISTINCT anon_id) AS devices
         FROM page_views WHERE day = ? GROUP BY day`,
        [today],
      ),
    ])

    const byDay = new Map<string, { views: number; devices: number }>()
    for (const r of [...rolled, ...todayAgg]) {
      byDay.set(String(r.d), { views: toNum(r.views), devices: toNum(r.devices) })
    }

    // Días con visitas pero sin consolidar (el cron no ha pasado todavía,
    // o falló). Se avisa en vez de mostrar huecos sin explicación.
    const closedWithRaw = await db.selectOrThrow<{ d: string; views: number; devices: number }>(
      `SELECT day AS d, COUNT(*) AS views, COUNT(DISTINCT anon_id) AS devices
       FROM page_views WHERE day >= ? AND day < ? GROUP BY day`,
      [from, today],
    )
    let sinConsolidar = 0
    for (const r of closedWithRaw) {
      const d = String(r.d)
      if (!byDay.has(d)) {
        byDay.set(d, { views: toNum(r.views), devices: toNum(r.devices) })
        sinConsolidar++
      }
    }
    if (sinConsolidar > 0) {
      warnings.push(
        `${sinConsolidar} día(s) sin consolidar por el cron nocturno: se muestran datos en crudo.`,
      )
    }

    // --- dispositivos nuevos por día, desde visitor_identity ---
    // Sustituye al CTE `WITH firsts AS (SELECT anon_id, MIN(ts) ...)`, que
    // recalculaba la "primera vez" sobre una tabla PURGADA a los 90 días:
    // un visitante de hace dos años volvía a contar como nuevo.
    const firsts = await db.selectOrThrow<{ d: string; n: number }>(
      `SELECT first_seen_day AS d, COUNT(*) AS n
       FROM visitor_identity WHERE first_seen_day >= ? GROUP BY first_seen_day`,
      [from],
    )
    const newPerDay = new Map(firsts.map(r => [String(r.d), toNum(r.n)]))

    const series: DailyPoint[] = days.map(d => {
      const agg = byDay.get(d) ?? { views: 0, devices: 0 }
      return {
        date: d,
        views: agg.views,
        devices: agg.devices,
        newDevices: Math.min(newPerDay.get(d) ?? 0, agg.devices),
      }
    })

    // --- dispositivos distintos del rango (rollup ∪ hoy) ---
    const distinctSql = (fromDay: string) => ({
      sql: `SELECT COUNT(*) AS n FROM (
              SELECT anon_id FROM daily_anon_stats WHERE date >= ? AND date < ?
              UNION
              SELECT anon_id FROM page_views WHERE day >= ? AND day <= ?
            )`,
      args: [fromDay, today, fromDay, today],
    })
    const [rangeRows, weekRows] = await Promise.all([
      db.selectOrThrow<{ n: number }>(distinctSql(from).sql, distinctSql(from).args),
      db.selectOrThrow<{ n: number }>(distinctSql(weekFrom).sql, distinctSql(weekFrom).args),
    ])
    const rangeDevices = toNum(rangeRows[0]?.n)
    const weekDevices = toNum(weekRows[0]?.n)

    // --- nuevos vs recurrentes ---
    // El panel restaba una SUMA de primeras-apariciones-diarias de un
    // COUNT(DISTINCT) de 30 días: magnitudes no comparables, y el
    // resultado salía 0 o directamente mal. Aquí `rangeNew` se cuenta
    // sobre el MISMO conjunto de dispositivos del rango, y los
    // recurrentes son el resto — con lo que la suma cuadra por
    // construcción. Un dispositivo sin fila en visitor_identity (datos
    // previos a la migración) cuenta como recurrente: no es demostrable
    // que sea nuevo.
    const newRows = await db.selectOrThrow<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT anon_id FROM daily_anon_stats WHERE date >= ? AND date < ?
         UNION
         SELECT anon_id FROM page_views WHERE day >= ? AND day <= ?
       ) a
       JOIN visitor_identity vi ON vi.anon_id = a.anon_id
       WHERE vi.first_seen_day >= ?`,
      [from, today, from, today, from],
    )
    const rangeNew = Math.min(toNum(newRows[0]?.n), rangeDevices)
    const rangeReturning = rangeDevices - rangeNew

    // --- desgloses ---
    const [rolledBreak, todayBreak] = await Promise.all([
      db.selectOrThrow<{ dim: string; label: string; views: number }>(
        `SELECT dim, label, SUM(views) AS views FROM daily_breakdowns
         WHERE date >= ? AND date < ? GROUP BY dim, label`,
        [from, today],
      ),
      db.selectOrThrow<{ dim: string; label: string; views: number }>(TODAY_BREAKDOWN_SQL, [today]),
    ])
    const allBreak = [...rolledBreak, ...todayBreak].map(r => ({
      dim: String(r.dim),
      label: String(r.label ?? ''),
      views: toNum(r.views),
    }))

    // --- sesiones ---
    const sessionRows = await db.selectOrThrow<{
      hoy: number
      rango: number
      vistas: number
      rebotes: number
    }>(
      `SELECT
         SUM(CASE WHEN started_day = ? THEN 1 ELSE 0 END) AS hoy,
         COUNT(*) AS rango,
         SUM(page_count) AS vistas,
         SUM(CASE WHEN page_count <= 1 THEN 1 ELSE 0 END) AS rebotes
       FROM sessions WHERE started_day >= ?`,
      [today, from],
    )
    const sessionsToday = toNum(sessionRows[0]?.hoy)
    const sessionsRange = toNum(sessionRows[0]?.rango)
    const viewsPerSession = sessionsRange > 0 ? toNum(sessionRows[0]?.vistas) / sessionsRange : null
    const bounceRate = sessionsRange > 0 ? toNum(sessionRows[0]?.rebotes) / sessionsRange : null

    // --- zonas (lectura pura, sin red) ---
    let zones: { label: string; views: number }[] = []
    try {
      // Se piden más celdas de las que se muestran porque varias celdas
      // vecinas suelen resolver al MISMO nombre ("Barcelona · Cataluña"
      // salía repetida en la lista) y se fusionan justo después.
      const cells = mergeBreakdown(allBreak, 'geo_cell', 24)
      if (cells.length > 0) {
        const names = await lookupZoneNames(cells.map(c => c.label))
        const porNombre = new Map<string, number>()
        for (const c of cells) {
          const nombre = names.get(c.label) ?? c.label
          porNombre.set(nombre, (porNombre.get(nombre) ?? 0) + c.count)
        }
        zones = [...porNombre.entries()]
          .map(([label, views]) => ({ label, views }))
          .sort((a, b) => b.views - a.views)
          .slice(0, 6)
      }
    } catch (err) {
      // Best-effort: el resto del panel es válido.
      warnings.push('No se pudieron resolver los nombres de zona.')
      console.error('[analytics] zonas:', err instanceof Error ? err.message : err)
    }

    const todayPoint = byDay.get(today) ?? { views: 0, devices: 0 }
    const yesterdayPoint = byDay.get(yesterday) ?? { views: 0, devices: 0 }

    return {
      ok: true,
      metrics: {
        rangeDays,
        today: todayPoint,
        yesterday: yesterdayPoint,
        weekDevices,
        rangeDevices,
        rangeNew,
        rangeReturning,
        series,
        topPaths: mergeBreakdown(allBreak, 'path'),
        referrers: mergeBreakdown(allBreak, 'referrer'),
        utmSources: mergeBreakdown(allBreak, 'utm_source'),
        devices: mergeBreakdown(allBreak, 'device'),
        browsers: mergeBreakdown(allBreak, 'browser'),
        countries: mergeBreakdown(allBreak, 'country'),
        locales: mergeBreakdown(allBreak, 'locale'),
        zones,
        sessionsToday,
        sessionsRange,
        viewsPerSession,
        bounceRate,
        warnings,
        generatedAt: Date.now(),
      },
    }
  } catch (err) {
    if (err instanceof DbError) {
      return { ok: false, error: err.kind === 'not_configured' ? 'not_configured' : 'query_failed', detail: err.message }
    }
    return { ok: false, error: 'query_failed', detail: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// Cron: consolidación + retención
// ---------------------------------------------------------------------------

export interface RollupResult {
  ok: boolean
  days?: number
  from?: string
  to?: string
  rolledUp?: number
  breakdownRows?: number
  zonesResolved?: number
  purgedViews?: number
  purgedSessions?: number
  purgedIdentities?: number
  purgeSkipped?: boolean
  reason?: string
}

/** Días cerrados pendientes de consolidar, en orden. */
async function pendingDays(now: number): Promise<string[]> {
  const today = todayKey(now)
  const floor = dayKey(now - RETENTION_DAYS * MS_PER_DAY)
  const rows = await db.selectOrThrow<{ d: string }>(
    `SELECT DISTINCT day AS d FROM page_views
     WHERE day >= ? AND day < ?
       AND day NOT IN (SELECT DISTINCT date FROM daily_anon_stats)
     ORDER BY day`,
    [floor, today],
  )
  return rows.map(r => String(r.d))
}

/**
 * Consolida los días cerrados y purga lo que cae fuera de la retención.
 *
 * El bucle anterior iba día a día desde `MAX(date) + 1` SIN tope real
 * pese a que su docstring prometía uno: con el cron caído 60 días, una
 * sola invocación intentaba 60 INSERT…SELECT con subconsulta
 * correlacionada y expiraba — y como expiraba, no avanzaba nunca. Aquí
 * se parte de los días que REALMENTE tienen filas crudas sin consolidar,
 * que en la práctica son muy pocos.
 */
export async function runAnalyticsRollup(now = Date.now()): Promise<RollupResult> {
  const migrations = await migrationsReady()
  if (!migrations.ok) return { ok: false, reason: `esquema no disponible: ${migrations.error}` }

  try {
    const days = await pendingDays(now)

    for (const day of days) {
      // Una fila por dispositivo y día. Aquí `sessions` por fin significa
      // algo: antes el id de sesión no rotaba nunca y este COUNT daba 1
      // para todo visitante recurrente.
      await db.executeOrThrow(
        `INSERT OR REPLACE INTO daily_anon_stats (date, anon_id, views, sessions, is_new)
         SELECT pv.day, pv.anon_id, COUNT(*), COUNT(DISTINCT pv.session_id),
                CASE WHEN vi.first_seen_day = pv.day THEN 1 ELSE 0 END
         FROM page_views pv
         LEFT JOIN visitor_identity vi ON vi.anon_id = pv.anon_id
         WHERE pv.day = ?
         GROUP BY pv.anon_id`,
        [day],
      )

      // Desgloses del día. Sin esta tabla el panel no podía servir
      // páginas/referentes/dispositivos desde el rollup y tenía que ir a
      // `page_views` en crudo sobre toda la ventana.
      await db.executeOrThrow(
        `INSERT OR REPLACE INTO daily_breakdowns (date, dim, label, views, devices)
         SELECT ?1, dim, label, SUM(views), SUM(devices) FROM (
           SELECT 'path' AS dim, path AS label, COUNT(*) AS views, COUNT(DISTINCT anon_id) AS devices FROM page_views WHERE day = ?1 GROUP BY path
           UNION ALL SELECT 'referrer', COALESCE(referrer, ''), COUNT(*), COUNT(DISTINCT anon_id) FROM page_views WHERE day = ?1 GROUP BY referrer
           UNION ALL SELECT 'utm_source', utm_source, COUNT(*), COUNT(DISTINCT anon_id) FROM page_views WHERE day = ?1 AND utm_source IS NOT NULL GROUP BY utm_source
           UNION ALL SELECT 'device', COALESCE(device_type, ''), COUNT(*), COUNT(DISTINCT anon_id) FROM page_views WHERE day = ?1 GROUP BY device_type
           UNION ALL SELECT 'browser', COALESCE(user_agent_browser, ''), COUNT(*), COUNT(DISTINCT anon_id) FROM page_views WHERE day = ?1 GROUP BY user_agent_browser
           UNION ALL SELECT 'country', COALESCE(country_code, ''), COUNT(*), COUNT(DISTINCT anon_id) FROM page_views WHERE day = ?1 GROUP BY country_code
           UNION ALL SELECT 'locale', COALESCE(locale, ''), COUNT(*), COUNT(DISTINCT anon_id) FROM page_views WHERE day = ?1 GROUP BY locale
           UNION ALL SELECT 'geo_cell', geo_cell, COUNT(*), COUNT(DISTINCT anon_id) FROM page_views WHERE day = ?1 AND geo_cell IS NOT NULL GROUP BY geo_cell
         ) GROUP BY dim, label`,
        [day],
      )

      // Rebote definitivo, ya con el page_count final de la sesión.
      await db.executeOrThrow(
        `UPDATE sessions SET is_bounce = CASE WHEN page_count <= 1 THEN 1 ELSE 0 END WHERE started_day = ?`,
        [day],
      )
    }

    // --- verificación ANTES de borrar nada ---
    // El código anterior purgaba siempre. Combinado con que `db.execute`
    // devolvía false en vez de lanzar, un rollup que fallaba por completo
    // seguía borrando los datos crudos: pérdida irreversible, reportada
    // como { ok: true }.
    const sinConsolidar = await pendingDays(now)
    if (sinConsolidar.length > 0) {
      return {
        ok: false,
        reason: `consolidación incompleta: quedan ${sinConsolidar.length} día(s) sin rollup (${sinConsolidar.slice(0, 5).join(', ')}). NO se ha purgado nada.`,
        days: days.length,
        purgeSkipped: true,
      }
    }

    const rolledRows = await db.selectOrThrow<{ n: number }>(
      'SELECT COUNT(*) AS n FROM daily_anon_stats WHERE date >= ?',
      [dayKey(now - RETENTION_DAYS * MS_PER_DAY)],
    )
    const breakRows = await db.selectOrThrow<{ n: number }>(
      'SELECT COUNT(*) AS n FROM daily_breakdowns WHERE date >= ?',
      [dayKey(now - RETENTION_DAYS * MS_PER_DAY)],
    )

    // Nombres de zona: fuera del camino de render, con presupuesto.
    let zonesResolved = 0
    try {
      zonesResolved = await resolveMissingZoneNames(20)
    } catch {
      /* best-effort */
    }

    // --- purga ---
    const cutoffDay = dayKey(now - RETENTION_DAYS * MS_PER_DAY)
    const identityCutoff = now - IDENTITY_RETENTION_DAYS * MS_PER_DAY
    const [cv, cs, ci] = await Promise.all([
      db.selectOrThrow<{ n: number }>('SELECT COUNT(*) AS n FROM page_views WHERE day < ?', [cutoffDay]),
      db.selectOrThrow<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE started_day < ?', [cutoffDay]),
      db.selectOrThrow<{ n: number }>('SELECT COUNT(*) AS n FROM visitor_identity WHERE last_seen_at < ?', [identityCutoff]),
    ])
    await db.executeOrThrow('DELETE FROM page_views WHERE day < ?', [cutoffDay])
    await db.executeOrThrow('DELETE FROM sessions WHERE started_day < ?', [cutoffDay])
    await db.executeOrThrow('DELETE FROM daily_anon_stats WHERE date < ?', [cutoffDay])
    await db.executeOrThrow('DELETE FROM daily_breakdowns WHERE date < ?', [cutoffDay])
    // La identidad vive lo que la cookie (2 años), no 90 días: si se
    // purgara con la retención corta, `first_seen_day` se perdería y
    // todo visitante antiguo volvería a contar como nuevo.
    await db.executeOrThrow('DELETE FROM visitor_identity WHERE last_seen_at < ? AND email IS NULL', [identityCutoff])

    return {
      ok: true,
      days: days.length,
      from: days[0],
      to: days[days.length - 1],
      rolledUp: toNum(rolledRows[0]?.n),
      breakdownRows: toNum(breakRows[0]?.n),
      zonesResolved,
      purgedViews: toNum(cv[0]?.n),
      purgedSessions: toNum(cs[0]?.n),
      purgedIdentities: toNum(ci[0]?.n),
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[analytics] rollup falló:', detail)
    return { ok: false, reason: detail, purgeSkipped: true }
  }
}

/** Exportado sólo para tests. */
export const __testing = { dayStartMs, pendingDays }

/**
 * B-NBT-10 (2026-08-22): analytics aggregation layer for the admin
 * metrics dashboard.
 *
 * Raw page_views stay the source of truth for the last N days; the cron
 * job (`/api/cron/analytics-rollup`) folds them into `daily_anon_stats`
 * and purges raw rows beyond the retention window. `visitor_identity`
 * links anonymous device ids to emails at the ONE moment they are known
 * together (premium claim), powering the lastSeen column in the admin
 * Users list.
 */

import { db } from './db'

const RETENTION_DAYS = 90

let schemaReady: Promise<boolean> | null = null

export async function ensureAnalyticsSchema(): Promise<boolean> {
  if (schemaReady) return schemaReady
  schemaReady = db.ensure().then(async ok => {
    if (!ok) return false
    try {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS daily_anon_stats (
          date TEXT NOT NULL,
          anon_id TEXT NOT NULL,
          views INTEGER NOT NULL DEFAULT 0,
          sessions INTEGER NOT NULL DEFAULT 0,
          is_new INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (date, anon_id)
        )`,
      )
      await db.execute('CREATE INDEX IF NOT EXISTS idx_das_date ON daily_anon_stats(date)')
      await db.execute(
        `CREATE TABLE IF NOT EXISTS visitor_identity (
          anon_id TEXT PRIMARY KEY,
          email TEXT,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        )`,
      )
      await db.execute('CREATE INDEX IF NOT EXISTS idx_vi_email ON visitor_identity(email)')
      return true
    } catch {
      schemaReady = null
      return false
    }
  }).catch(() => { schemaReady = null; return false })
  return schemaReady
}

/** Called on every accepted pageview â€” cheap upsert keeping last_seen
 *  fresh. Failures are non-fatal by design. */
export async function touchVisitorIdentity(anonId: string, now = Date.now()): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO visitor_identity (anon_id, first_seen_at, last_seen_at)
       VALUES (?, ?, ?)
       ON CONFLICT(anon_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      [anonId, now, now],
    )
  } catch {
    /* best-effort */
  }
}

/** Link a device to an email at claim time. Keeps the earliest
 *  first_seen and the latest email/last_seen. */
export async function linkVisitorIdentity(anonId: string, email: string, now = Date.now()): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO visitor_identity (anon_id, email, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(anon_id) DO UPDATE SET
         email = excluded.email,
         last_seen_at = excluded.last_seen_at`,
      [anonId, email.toLowerCase(), now, now],
    )
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Admin metric queries (all read-only)
// ---------------------------------------------------------------------------

export interface DailyPoint {
  date: string // YYYY-MM-DD (UTC)
  devices: number
  views: number
  newDevices: number
}

export interface BreakdownRow { label: string; count: number }

export interface AdminMetrics {
  rangeDays: number
  today: { devices: number; views: number }
  yesterday: { devices: number; views: number }
  weekDevices: number
  monthDevices: number
  series: DailyPoint[]
  topPaths: BreakdownRow[]
  referrers: BreakdownRow[]
  utmSources: BreakdownRow[]
  devices: BreakdownRow[]
  browsers: BreakdownRow[]
  countries: BreakdownRow[]
  zones: { label: string; devices: number; views: number }[]
  sessionsToday: number
  generatedAt: number
}

function dayStartUtcMs(dayOffsetFromToday: number, now: number): number {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime() + dayOffsetFromToday * 86_400_000
}

// ---------------------------------------------------------------------------
// Resolución de nombres de zona (reverse-geocode con cache permanente)
// ---------------------------------------------------------------------------

const geoNameCache = new Map<string, string>()

/** Resuelve el nombre de una celda "lat,lon" (2 decimales ≈ 1.1 km)
 *  vía BigDataCloud (el mismo endpoint público que usa
 *  /api/reverse-geocode). Cachea en memoria Y en la tabla geo_names
 *  para no gastar cuota: máx 5 lookups por invocación. */
async function resolveZoneNames(cells: string[]): Promise<Map<string, string>> {
  await ensureAnalyticsSchema()
  const out = new Map<string, string>()
  const missing: string[] = []
  for (const cell of cells) {
    const cached = geoNameCache.get(cell)
    if (cached) { out.set(cell, cached); continue }
    try {
      const rows = await db.select<{ name: string }>(
        'SELECT name FROM geo_names WHERE cell = ?', [cell],
      )
      if (rows[0]) {
        const name = String(rows[0].name)
        geoNameCache.set(cell, name)
        out.set(cell, name)
        continue
      }
    } catch { /* la tabla puede no existir aún — se crea abajo */ }
    missing.push(cell)
  }
  try {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS geo_names (
        cell TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    )
  } catch { /* best-effort */ }

  let lookups = 0
  for (const cell of missing.slice(0, 5)) {
    if (lookups >= 5) break
    const parts = cell.split(',')
    const lat = Number(parts[0])
    const lon = Number(parts[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    try {
      const res = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=es`,
        { signal: AbortSignal.timeout(4000) },
      )
      lookups++
      if (!res.ok) continue
      const data = (await res.json()) as { city?: string; locality?: string; principalSubdivision?: string; countryName?: string }
      const name = [data.city || data.locality, data.principalSubdivision]
        .filter(Boolean).join(' · ') || data.countryName || cell
      geoNameCache.set(cell, name)
      out.set(cell, name)
      try {
        await db.execute(
          'INSERT OR REPLACE INTO geo_names (cell, name, created_at) VALUES (?, ?, ?)',
          [cell, name, Date.now()],
        )
      } catch { /* best-effort */ }
    } catch { /* timeout/red → dejamos la celda cruda */ }
  }
  // Celdas sin resolver → etiqueta cruda
  for (const cell of cells) {
    if (!out.has(cell)) out.set(cell, cell)
  }
  return out
}

/** Full dashboard payload. `now` injectable for tests. */
export async function getAdminMetrics(rangeDays = 30, now = Date.now()): Promise<AdminMetrics | null> {
  if (!(await ensureAnalyticsSchema())) return null

  const todayStart = dayStartUtcMs(0, now)
  const yesterdayStart = dayStartUtcMs(-1, now)
  const rangeStart = todayStart - (rangeDays - 1) * 86_400_000

  try {
    const kpi = await db.select<{ d: string; devices: number; views: number }>(
      `SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS d,
              COUNT(DISTINCT anon_id) AS devices,
              COUNT(*) AS views
       FROM page_views
       WHERE ts >= ?
       GROUP BY d`,
      [rangeStart],
    )

    const byDay = new Map<string, { devices: number; views: number }>()
    for (const r of kpi) {
      byDay.set(String(r.d), { devices: Number(r.devices), views: Number(r.views) })
    }
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
    const todayIso = iso(todayStart)
    const yesterdayIso = iso(yesterdayStart)

    const series: DailyPoint[] = []
    let newPerDay = new Map<string, number>()
    const firsts = await db.select<{ d: string; n: number }>(
      `WITH firsts AS (SELECT anon_id, MIN(ts) AS f FROM page_views GROUP BY anon_id)
       SELECT strftime('%Y-%m-%d', f / 1000, 'unixepoch') AS d, COUNT(*) AS n
       FROM firsts WHERE f >= ? GROUP BY d`,
      [rangeStart],
    )
    for (const r of firsts) {
      newPerDay.set(String(r.d), Number(r.n))
    }
    newPerDay = new Map([...newPerDay.entries()].filter(([d]) => d >= iso(rangeStart)))

    for (let i = 0; i < rangeDays; i++) {
      const dIso = iso(todayStart - i * 86_400_000)
      const agg = byDay.get(dIso) ?? { devices: 0, views: 0 }
      series.push({
        date: dIso,
        devices: agg.devices,
        views: agg.views,
        newDevices: Math.min(newPerDay.get(dIso) ?? 0, agg.devices),
      })
    }

    const sumRange = (fromIso: string) => {
      let devices = 0
      let views = 0
      for (const [d, v] of byDay) {
        if (d >= fromIso) { devices += v.devices; views += v.views }
      }
      return { devices, views }
    }
    const week = sumRange(iso(todayStart - 6 * 86_400_000))
    const month = sumRange(iso(rangeStart))
    // Distinct uniques over the whole window need DISTINCT, not sums.
    const distinctWeek = await db.select<{ n: number }>(
      'SELECT COUNT(DISTINCT anon_id) AS n FROM page_views WHERE ts >= ?',
      [todayStart - 6 * 86_400_000],
    )
    const distinctMonth = await db.select<{ n: number }>(
      'SELECT COUNT(DISTINCT anon_id) AS n FROM page_views WHERE ts >= ?',
      [rangeStart],
    )
    const distinct = (rows: { n: number }[]) => (rows[0] ? Number(rows[0].n) : 0)

    async function breakdown(sql: string, args: (string | number)[]): Promise<BreakdownRow[]> {
      const res = await db.select<{ label: string; count: number }>(sql, args)
      return res
        .map(r => ({ label: r.label || '(directo)', count: Number(r.count) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
    }

    // B-NBT-12: "Páginas" solo con páginas reales — las rutas internas
    // (/api/*, manifest, iconos) ya ni se insertan (pageview route), y
    // este filtro adicional protege el histórico viejo que sí las lleva.
    const PAGE_FILTER = " AND path NOT LIKE '/api/%' AND path NOT LIKE '/manifest.json%' AND path NOT LIKE '/_next%' AND path NOT LIKE '/icon-%'"

    const [topPaths, referrers, utmSources, devices, browsers, countries] = await Promise.all([
      breakdown(`SELECT path AS label, COUNT(*) AS count FROM page_views WHERE ts >= ?${PAGE_FILTER} GROUP BY path ORDER BY count DESC LIMIT 10`, [rangeStart]),
      breakdown("SELECT COALESCE(referrer, '') AS label, COUNT(*) AS count FROM page_views WHERE ts >= ? GROUP BY referrer", [rangeStart]),
      breakdown("SELECT COALESCE(utm_source, '') AS label, COUNT(*) AS count FROM page_views WHERE ts >= ? AND utm_source IS NOT NULL GROUP BY utm_source", [rangeStart]),
      breakdown("SELECT COALESCE(device_type, '') AS label, COUNT(DISTINCT anon_id) AS count FROM page_views WHERE ts >= ? GROUP BY device_type", [rangeStart]),
      breakdown("SELECT COALESCE(user_agent_browser, '') AS label, COUNT(DISTINCT anon_id) AS count FROM page_views WHERE ts >= ? GROUP BY user_agent_browser", [rangeStart]),
      breakdown("SELECT COALESCE(country, '') AS label, COUNT(DISTINCT anon_id) AS count FROM page_views WHERE ts >= ? GROUP BY country", [rangeStart]),
    ])

    // B-NBT-12: zonas — celdas geográficas ~1-5 km derivadas del URL
    // state. Dispositivos ÚNICOS por celda (COUNT DISTINCT anon_id), no
    // sesiones: un mismo dispositivo con 50 sesiones cuenta una vez.
    let zones: { label: string; devices: number; views: number }[] = []
    try {
      const cellRows = await db.select<{ cell: string; devices: number; views: number }>(
        `SELECT geo_cell AS cell,
                COUNT(DISTINCT anon_id) AS devices,
                COUNT(*) AS views
         FROM page_views
         WHERE ts >= ? AND geo_cell IS NOT NULL
         GROUP BY geo_cell
         ORDER BY devices DESC, views DESC
         LIMIT 6`,
        [rangeStart],
      )
      if (cellRows.length > 0) {
        const names = await resolveZoneNames(cellRows.map(r => String(r.cell)))
        zones = cellRows.map(r => ({
          label: names.get(String(r.cell)) ?? String(r.cell),
          devices: Number(r.devices),
          views: Number(r.views),
        })).sort((a, b) => b.devices - a.devices)
      }
    } catch {
      /* zonas best-effort */
    }

    // B-NBT-12: sesiones de HOY — métrica separada de dispositivos para
    // dejar explícito que un dispositivo genera N sesiones.
    let sessionsToday = 0
    try {
      const st = await db.select<{ n: number }>(
        'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ?',
        [todayStart],
      )
      sessionsToday = Number(st[0]?.n ?? 0)
    } catch { /* best-effort */ }

    return {
      rangeDays,
      today: byDay.get(todayIso) ?? { devices: 0, views: 0 },
      yesterday: byDay.get(yesterdayIso) ?? { devices: 0, views: 0 },
      weekDevices: distinct(distinctWeek),
      monthDevices: distinct(distinctMonth),
      series,
      zones,
      sessionsToday,
      topPaths,
      referrers,
      utmSources,
      devices,
      browsers,
      countries,
      generatedAt: Date.now(),
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Cron: rollup + retention
// ---------------------------------------------------------------------------

/** Fold yesterday's raw page_views into daily_anon_stats and purge raw
 *  rows older than RETENTION_DAYS. Idempotent (INSERT OR REPLACE).
 *  Returns the rolled-up day and purged-row counts for logging. */
export async function runAnalyticsRollup(now = Date.now()): Promise<{
  ok: boolean
  day?: string
  rolledUp?: number
  purgedViews?: number
  purgedSessions?: number
  reason?: string
}> {
  if (!(await ensureAnalyticsSchema())) return { ok: false, reason: 'db_unavailable' }
  try {
    const yesterdayStart = dayStartUtcMs(-1, now)
    const dayEnd = dayStartUtcMs(0, now)
    const dayIso = new Date(yesterdayStart).toISOString().slice(0, 10)

    await db.execute(
      `INSERT OR REPLACE INTO daily_anon_stats (date, anon_id, views, sessions, is_new)
       SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS d,
              anon_id,
              COUNT(*),
              COUNT(DISTINCT session_id),
              CASE WHEN MIN(ts) = (
                SELECT MIN(pv2.ts) FROM page_views pv2
                WHERE pv2.anon_id = page_views.anon_id
              ) THEN 1 ELSE 0 END
       FROM page_views
       WHERE ts >= ? AND ts < ?
       GROUP BY anon_id`,
      [yesterdayStart, dayEnd],
    )

    const cutoff = now - RETENTION_DAYS * 86_400_000
    // The db adapter hides rowsAffected, so count-then-delete to report
    // purged volumes.
    const countViews = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM page_views WHERE ts < ?', [cutoff])
    const countSessions = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE last_seen_at < ?', [cutoff])
    await db.execute('DELETE FROM page_views WHERE ts < ?', [cutoff])
    await db.execute('DELETE FROM sessions WHERE last_seen_at < ?', [cutoff])

    return {
      ok: true,
      day: dayIso,
      rolledUp: 0,
      purgedViews: Number(countViews[0]?.n ?? 0),
      purgedSessions: Number(countSessions[0]?.n ?? 0),
    }
  } catch (err) {
    return { ok: false, reason: String(err) }
  }
}

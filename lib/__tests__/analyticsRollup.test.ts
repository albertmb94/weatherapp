import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'

vi.hoisted(() => {
  process.env.TURSO_DATABASE_URL = 'file::memory:'
  delete process.env.TURSO_AUTH_TOKEN
})

import { db } from '@/lib/db'
import { runMigrations } from '@/lib/migrations'
import { getAdminMetrics, runAnalyticsRollup, touchVisitorIdentity } from '@/lib/analytics'
import { dayStartMs } from '@/lib/analytics/time'

/** 27 ago 2026, 12:00 en Madrid. */
const NOW = Date.UTC(2026, 7, 27, 10, 0)
const HOY = '2026-08-27'
const AYER = '2026-08-26'
const ANTEAYER = '2026-08-25'

let seq = 0

/** Inserta un pageview con el mismo contrato que usa la ruta de ingesta. */
async function visita(opts: {
  anon: string
  day: string
  path?: string
  session?: string
  device?: string
  browser?: string
  country?: string
  locale?: string
  geo?: string
  referrer?: string
  utm?: string
}): Promise<void> {
  const ts = dayStartMs(opts.day) + 12 * 3_600_000
  await db.executeOrThrow(
    `INSERT INTO page_views
       (id, anon_id, path, referrer, utm_source, country_code, locale,
        user_agent_browser, device_type, ts, day, session_id, geo_cell)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `row${++seq}`,
      opts.anon,
      opts.path ?? '/',
      opts.referrer ?? null,
      opts.utm ?? null,
      opts.country ?? 'ES',
      opts.locale ?? 'es-ES',
      opts.browser ?? 'Chrome',
      opts.device ?? 'desktop',
      ts,
      opts.day,
      opts.session ?? `s-${opts.anon}-${opts.day}`,
      opts.geo ?? null,
    ],
  )
  await db.executeOrThrow(
    `INSERT INTO sessions (id, anon_id, started_at, started_day, last_seen_at, page_count, entry_path)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET page_count = sessions.page_count + 1, last_seen_at = excluded.last_seen_at`,
    [opts.session ?? `s-${opts.anon}-${opts.day}`, opts.anon, ts, opts.day, ts, opts.path ?? '/'],
  )
  await touchVisitorIdentity(opts.anon, ts)
}

async function limpiar(): Promise<void> {
  for (const t of ['page_views', 'sessions', 'daily_anon_stats', 'daily_breakdowns', 'visitor_identity', 'geo_names']) {
    await db.executeOrThrow(`DELETE FROM ${t}`)
  }
}

async function contar(tabla: string, where = '1=1', args: unknown[] = []): Promise<number> {
  const r = await db.selectOrThrow<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${where}`, args as never)
  return Number(r[0]?.n ?? 0)
}

beforeAll(async () => {
  expect(await db.ensure()).toBe(true)
  expect((await runMigrations()).ok).toBe(true)
})

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  await limpiar()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runAnalyticsRollup', () => {
  it('consolida los días CERRADOS y deja hoy en crudo', async () => {
    await visita({ anon: 'a1', day: ANTEAYER })
    await visita({ anon: 'a1', day: AYER })
    await visita({ anon: 'a2', day: AYER })
    await visita({ anon: 'a3', day: HOY })

    const res = await runAnalyticsRollup(NOW)
    expect(res.ok).toBe(true)
    expect(res.days).toBe(2)

    const stats = await db.selectOrThrow<{ date: string; anon_id: string; views: number }>(
      'SELECT date, anon_id, views FROM daily_anon_stats ORDER BY date, anon_id',
    )
    expect(stats.map(s => `${s.date}:${s.anon_id}`)).toEqual([
      `${ANTEAYER}:a1`,
      `${AYER}:a1`,
      `${AYER}:a2`,
    ])
    // Hoy NO se consolida: sigue vivo y cambiando.
    expect(stats.some(s => s.date === HOY)).toBe(false)
  })

  it('escribe los desgloses diarios que el panel necesita', async () => {
    await visita({ anon: 'a1', day: AYER, path: '/premium', browser: 'Firefox', geo: '41.45,2.25' })
    await visita({ anon: 'a2', day: AYER, path: '/premium', browser: 'Chrome', geo: '41.45,2.25' })
    await runAnalyticsRollup(NOW)

    const rows = await db.selectOrThrow<{ dim: string; label: string; views: number; devices: number }>(
      "SELECT dim, label, views, devices FROM daily_breakdowns WHERE date = ? AND dim IN ('path','browser','geo_cell') ORDER BY dim, label",
      [AYER],
    )
    expect(rows).toEqual([
      { dim: 'browser', label: 'Chrome', views: 1, devices: 1 },
      { dim: 'browser', label: 'Firefox', views: 1, devices: 1 },
      { dim: 'geo_cell', label: '41.45,2.25', views: 2, devices: 2 },
      { dim: 'path', label: '/premium', views: 2, devices: 2 },
    ])
  })

  it('cuenta sesiones DISTINTAS por dispositivo y día', async () => {
    // Con el id de sesión que no rotaba nunca, esto siempre daba 1.
    await visita({ anon: 'a1', day: AYER, session: 'ses-1' })
    await visita({ anon: 'a1', day: AYER, session: 'ses-2' })
    await visita({ anon: 'a1', day: AYER, session: 'ses-3' })
    await runAnalyticsRollup(NOW)

    const r = await db.selectOrThrow<{ views: number; sessions: number }>(
      'SELECT views, sessions FROM daily_anon_stats WHERE date = ? AND anon_id = ?',
      [AYER, 'a1'],
    )
    expect(r[0]).toEqual({ views: 3, sessions: 3 })
  })

  it('es idempotente: dos pasadas dan el mismo resultado', async () => {
    await visita({ anon: 'a1', day: AYER })
    await visita({ anon: 'a2', day: AYER })
    await runAnalyticsRollup(NOW)
    const antes = await db.selectOrThrow('SELECT * FROM daily_anon_stats ORDER BY date, anon_id')
    const breakAntes = await contar('daily_breakdowns')

    const segunda = await runAnalyticsRollup(NOW)
    expect(segunda.ok).toBe(true)
    expect(segunda.days).toBe(0) // ya no queda nada pendiente
    expect(await db.selectOrThrow('SELECT * FROM daily_anon_stats ORDER BY date, anon_id')).toEqual(antes)
    expect(await contar('daily_breakdowns')).toBe(breakAntes)
  })

  it('marca is_new usando visitor_identity, no MIN(ts) sobre una tabla purgada', async () => {
    // El bug: `CASE WHEN MIN(ts) = (SELECT MIN(ts) FROM page_views ...)`
    // se calculaba sobre datos ya purgados a los 90 días, así que un
    // visitante de hace dos años volvía a contar como nuevo.
    await visita({ anon: 'viejo', day: ANTEAYER })
    // Reescribimos su primera visión a hace un año, como si su historial
    // crudo ya se hubiera purgado.
    await db.executeOrThrow(
      "UPDATE visitor_identity SET first_seen_day = '2025-08-01' WHERE anon_id = 'viejo'",
    )
    await visita({ anon: 'nuevo', day: AYER })
    await runAnalyticsRollup(NOW)

    const rows = await db.selectOrThrow<{ anon_id: string; is_new: number }>(
      'SELECT anon_id, is_new FROM daily_anon_stats WHERE date = ?',
      [AYER],
    )
    expect(rows.find(r => r.anon_id === 'nuevo')?.is_new).toBe(1)
    const viejoAyer = rows.find(r => r.anon_id === 'viejo')
    expect(viejoAyer).toBeUndefined() // no visitó ayer
  })
})

describe('guard del purgado (única pérdida de datos irreversible del sistema)', () => {
  it('NO purga nada cuando la consolidación falla', async () => {
    await visita({ anon: 'a1', day: AYER })
    // Fila antiquísima, muy fuera de la retención de 90 días: es la que
    // el purgado borraría.
    await db.executeOrThrow(
      `INSERT INTO page_views (id, anon_id, path, ts, day, session_id) VALUES ('antigua', 'a0', '/', 0, '2020-01-01', 's0')`,
    )
    expect(await contar('page_views')).toBe(2)

    // Simula un fallo real a mitad del rollup.
    await db.executeOrThrow('ALTER TABLE daily_breakdowns RENAME TO daily_breakdowns_tmp')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await runAnalyticsRollup(NOW)
      expect(res.ok).toBe(false)
      expect(res.purgeSkipped).toBe(true)
      // LA FILA ANTIGUA SIGUE AHÍ. El código anterior la habría borrado
      // igualmente y habría devuelto { ok: true }.
      expect(await contar('page_views')).toBe(2)
      expect(await contar('page_views', "day = '2020-01-01'")).toBe(1)
    } finally {
      err.mockRestore()
      await db.executeOrThrow('ALTER TABLE daily_breakdowns_tmp RENAME TO daily_breakdowns')
    }
  })

  it('purga sólo cuando la consolidación se ha verificado', async () => {
    await visita({ anon: 'a1', day: AYER })
    await db.executeOrThrow(
      `INSERT INTO page_views (id, anon_id, path, ts, day, session_id) VALUES ('antigua', 'a0', '/', 0, '2020-01-01', 's0')`,
    )
    await db.executeOrThrow(
      `INSERT INTO sessions (id, anon_id, started_at, started_day, last_seen_at) VALUES ('s0', 'a0', 0, '2020-01-01', 0)`,
    )

    const res = await runAnalyticsRollup(NOW)
    expect(res.ok).toBe(true)
    expect(res.purgedViews).toBe(1)
    expect(await contar('page_views', "day = '2020-01-01'")).toBe(0)
    expect(await contar('page_views', 'day = ?', [AYER])).toBe(1)
  })

  it('conserva visitor_identity mucho más que los datos crudos', async () => {
    // Si la identidad se purgara con la retención corta, `first_seen_day`
    // se perdería y todo visitante antiguo volvería a contar como nuevo.
    await visita({ anon: 'a1', day: AYER })
    await db.executeOrThrow(
      "UPDATE visitor_identity SET first_seen_day = '2020-01-01', first_seen_at = 0 WHERE anon_id = 'a1'",
    )
    const res = await runAnalyticsRollup(NOW)
    expect(res.ok).toBe(true)
    // last_seen_at es reciente, así que sobrevive.
    expect(await contar('visitor_identity', "anon_id = 'a1'")).toBe(1)
  })
})

describe('getAdminMetrics', () => {
  it('mezcla días cerrados (rollup) con hoy (crudo) SIN contar dos veces', async () => {
    await visita({ anon: 'a1', day: AYER })
    await visita({ anon: 'a1', day: AYER })
    await visita({ anon: 'a2', day: HOY })
    await runAnalyticsRollup(NOW)

    const res = await getAdminMetrics(30, NOW)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const m = res.metrics

    const ayer = m.series.find(s => s.date === AYER)
    const hoy = m.series.find(s => s.date === HOY)
    expect(ayer).toMatchObject({ views: 2, devices: 1 })
    expect(hoy).toMatchObject({ views: 1, devices: 1 })
    expect(m.today).toEqual({ views: 1, devices: 1 })
    expect(m.yesterday).toEqual({ views: 2, devices: 1 })
    expect(m.rangeDevices).toBe(2)
    // Las vistas totales de la serie no duplican hoy.
    expect(m.series.reduce((a, s) => a + s.views, 0)).toBe(3)
  })

  it('nuevos + recurrentes === únicos del rango, EXACTAMENTE', async () => {
    // El panel restaba una suma de primeras-apariciones-diarias de un
    // COUNT(DISTINCT) de 30 días: magnitudes incomparables.
    await visita({ anon: 'nuevo1', day: HOY })
    await visita({ anon: 'nuevo2', day: AYER })
    await visita({ anon: 'viejo1', day: AYER })
    await db.executeOrThrow(
      "UPDATE visitor_identity SET first_seen_day = '2025-01-01' WHERE anon_id = 'viejo1'",
    )
    await runAnalyticsRollup(NOW)

    const res = await getAdminMetrics(30, NOW)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const m = res.metrics
    expect(m.rangeNew + m.rangeReturning).toBe(m.rangeDevices)
    expect(m.rangeDevices).toBe(3)
    expect(m.rangeNew).toBe(2)
    expect(m.rangeReturning).toBe(1)
  })

  it('devuelve la serie de la longitud pedida para cada rango permitido', async () => {
    for (const n of [7, 30, 90] as const) {
      const res = await getAdminMetrics(n, NOW)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.metrics.series).toHaveLength(n)
      expect(res.metrics.rangeDays).toBe(n)
      expect(res.metrics.series[n - 1].date).toBe(HOY)
    }
  })

  it('los desgloses suman VISTAS de días cerrados y de hoy', async () => {
    await visita({ anon: 'a1', day: AYER, path: '/premium' })
    await visita({ anon: 'a2', day: HOY, path: '/premium' })
    await visita({ anon: 'a2', day: HOY, path: '/' })
    await runAnalyticsRollup(NOW)

    const res = await getAdminMetrics(30, NOW)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const premium = res.metrics.topPaths.find(p => p.label === '/premium')
    expect(premium?.count).toBe(2)
  })

  it('calcula sesiones, vistas por sesión y rebote', async () => {
    await visita({ anon: 'a1', day: HOY, session: 'ses-a' })
    await visita({ anon: 'a1', day: HOY, session: 'ses-a' }) // 2 vistas
    await visita({ anon: 'a2', day: HOY, session: 'ses-b' }) // 1 vista = rebote

    const res = await getAdminMetrics(30, NOW)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.metrics.sessionsToday).toBe(2)
    expect(res.metrics.viewsPerSession).toBeCloseTo(1.5)
    expect(res.metrics.bounceRate).toBeCloseTo(0.5)
  })

  it('avisa (sin romperse) de los días con datos crudos que el cron no consolidó', async () => {
    await visita({ anon: 'a1', day: AYER })
    // Sin ejecutar el rollup.
    const res = await getAdminMetrics(30, NOW)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.metrics.warnings.join(' ')).toContain('sin consolidar')
    // Y AUN ASÍ muestra el dato real, en vez de un hueco silencioso.
    expect(res.metrics.series.find(s => s.date === AYER)?.views).toBe(1)
  })

  it('con una tabla ausente devuelve ERROR, no un panel de ceros', async () => {
    // Éste es el comportamiento cuya ausencia hizo que el apagón durase
    // meses: `db.select` devolvía [] ante "no such table" y el panel
    // pintaba "0 dispositivos", idéntico a un día tranquilo.
    await db.executeOrThrow('ALTER TABLE page_views RENAME TO page_views_tmp')
    try {
      const res = await getAdminMetrics(30, NOW)
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.error).toBe('query_failed')
      expect(res.detail).toBeTruthy()
    } finally {
      await db.executeOrThrow('ALTER TABLE page_views_tmp RENAME TO page_views')
    }
  })

  it('sin tráfico devuelve ok con ceros, que NO es lo mismo que un error', async () => {
    const res = await getAdminMetrics(7, NOW)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.metrics.rangeDevices).toBe(0)
    expect(res.metrics.warnings).toEqual([])
  })
})

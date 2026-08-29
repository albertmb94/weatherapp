import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  process.env.TURSO_DATABASE_URL = 'file::memory:'
  delete process.env.TURSO_AUTH_TOKEN
})

vi.mock('@/lib/features', () => ({
  getFeature: vi.fn(async () => ({ enabled: false, config: {} })),
}))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: () => true }))

import { db } from '@/lib/db'
import { runMigrations } from '@/lib/migrations'
import { GET } from '@/app/api/health/route'
import { dayStartMs } from '@/lib/analytics/time'

/**
 * Estado del cron nocturno en /api/health.
 *
 * POR QUÉ EXISTE: `CRON_SECRET` no llegó a definirse en producción, y
 * Vercel sólo añade la cabecera `Authorization: Bearer` a la llamada
 * programada CUANDO esa variable existe. Sin ella el endpoint del cron
 * respondía 503 a su propia invocación nocturna: el rollup no corrió ni
 * una vez y la analítica dejó de consolidarse durante CUATRO DÍAS, con el
 * único aviso en otra pantalla y sólo cuando ya había daño.
 *
 * Se ejecuta contra SQLite real y no contra mocks porque lo que se está
 * comprobando es una CONSULTA: qué días tienen datos sin consolidar.
 */

let seq = 0
async function visitaEn(dia: string): Promise<void> {
  await db.executeOrThrow(
    `INSERT INTO page_views (id, anon_id, path, ts, day, session_id)
     VALUES (?, 'anon1', '/', ?, ?, 's1')`,
    [`r${++seq}`, dayStartMs(dia) + 3_600_000, dia],
  )
}

async function consolidado(dia: string): Promise<void> {
  await db.executeOrThrow(
    `INSERT OR REPLACE INTO daily_anon_stats (date, anon_id, views, sessions, is_new)
     VALUES (?, 'anon1', 1, 1, 0)`,
    [dia],
  )
}

function pet(): NextRequest {
  return new NextRequest('http://localhost:3000/api/health')
}

async function cron() {
  const body = await (await GET(pet())).json()
  return body.checks.cron as { ok: boolean; detail?: string }
}

describe('/api/health · estado del cron nocturno', () => {
  const CRON = process.env.CRON_SECRET

  beforeAll(async () => {
    await runMigrations()
  })

  beforeEach(async () => {
    vi.useFakeTimers()
    // 2026-08-29 10:00 en Madrid.
    vi.setSystemTime(new Date('2026-08-29T08:00:00Z'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    await db.executeOrThrow('DELETE FROM page_views')
    await db.executeOrThrow('DELETE FROM daily_anon_stats')
    seq = 0
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    if (CRON === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = CRON
  })

  it('sin CRON_SECRET avisa de que el rollup NUNCA se ejecuta', async () => {
    // El caso que estuvo cuatro días sin detectarse: sin la variable,
    // Vercel no manda el bearer y el endpoint rechaza su propia llamada.
    delete process.env.CRON_SECRET

    const c = await cron()
    expect(c.ok).toBe(false)
    expect(c.detail).toContain('CRON_SECRET')
  })

  it('con todo consolidado, ok', async () => {
    process.env.CRON_SECRET = 'x'
    await visitaEn('2026-08-28')
    await consolidado('2026-08-28')

    const c = await cron()
    expect(c.ok).toBe(true)
    expect(c.detail).toContain('2026-08-28')
  })

  it('UN DÍA SIN VISITAS NO ES UN CRON ATRASADO', async () => {
    // ESTE es el caso que rompía la versión anterior: comparaba
    // MAX(date) con "ayer" sin más, así que un día sin tráfico salía en
    // rojo aunque el cron hubiera hecho exactamente lo que debía. Una
    // alarma que salta cuando no pasa nada enseña a ignorar el rojo.
    process.env.CRON_SECRET = 'x'
    await visitaEn('2026-08-26')
    await consolidado('2026-08-26')
    // El 27 y el 28 no tuvieron ni una visita: no hay nada que consolidar.

    const c = await cron()
    expect(c.ok, `no debería avisar de nada: ${c.detail}`).toBe(true)
  })

  it('cuenta los días CON DATOS que quedaron sin consolidar', async () => {
    process.env.CRON_SECRET = 'x'
    await visitaEn('2026-08-25')
    await visitaEn('2026-08-26')
    await visitaEn('2026-08-28')

    const c = await cron()
    expect(c.ok).toBe(false)
    expect(c.detail).toContain('3 día(s)')
    expect(c.detail).toContain('2026-08-25')
  })

  it('las visitas de HOY no cuentan: el cron consolida días cerrados', async () => {
    process.env.CRON_SECRET = 'x'
    await visitaEn('2026-08-29')

    const c = await cron()
    expect(c.ok, `hoy aún no toca consolidarlo: ${c.detail}`).toBe(true)
  })

  it('sin tráfico ninguno, ok: no hay nada que consolidar', async () => {
    process.env.CRON_SECRET = 'x'

    const c = await cron()
    expect(c.ok).toBe(true)
    expect(c.detail).toContain('nada que consolidar')
  })

  it('un cron atrasado NO tumba el health global', async () => {
    // Los monitores de uptime miran el código HTTP. Un rollup con retraso
    // es un aviso de operación, no una caída: si devolviera 503 acabaría
    // siendo ruido que se ignora.
    process.env.CRON_SECRET = 'x'
    await visitaEn('2026-08-20')

    const res = await GET(pet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.checks.cron.ok).toBe(false)
  })
})

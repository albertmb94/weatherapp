import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { selectOrThrowMock } = vi.hoisted(() => ({
  selectOrThrowMock: vi.fn(),
}))
vi.mock('@/lib/db', async () => {
  const real = await vi.importActual<typeof import('@/lib/db')>('@/lib/db')
  return {
    ...real,
    db: { selectOrThrow: selectOrThrowMock },
  }
})

vi.mock('@/lib/migrations', () => ({
  migrationStatus: vi.fn(async () => ({
    ok: true,
    currentVersion: 6,
    latestVersion: 6,
    applied: [],
    pending: [],
    drift: [],
  })),
}))

vi.mock('@/lib/features', () => ({
  getFeature: vi.fn(async () => ({ enabled: false, config: {} })),
}))

vi.mock('@/lib/rateLimit', () => ({ rateLimit: () => true }))

import { GET } from '@/app/api/health/route'

function req(): NextRequest {
  return new NextRequest('http://localhost:3000/api/health')
}

/** Respuestas de db.selectOrThrow en el orden en que las pide la ruta:
 *  1) SELECT 1  2) MAX(date) de daily_anon_stats */
function conUltimoRollup(dia: string | null) {
  selectOrThrowMock.mockReset()
  selectOrThrowMock
    .mockResolvedValueOnce([{ ok: 1 }])
    .mockResolvedValueOnce([{ d: dia }])
}

describe('/api/health · estado del cron nocturno', () => {
  const CRON = process.env.CRON_SECRET

  beforeEach(() => {
    vi.useFakeTimers()
    // 2026-08-28 10:00 en Madrid. El cron consolida días CERRADOS, así
    // que "al día" significa que el último consolidado es 2026-08-27.
    vi.setSystemTime(new Date('2026-08-28T08:00:00Z'))
    // El probe a Open-Meteo sale por red: se anula.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    if (CRON === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = CRON
  })

  it('sin CRON_SECRET avisa de que el rollup NUNCA se ejecuta', async () => {
    // Este es el caso que estuvo cuatro días sin detectarse en producción:
    // Vercel solo manda la cabecera Bearer si la variable existe, así que
    // sin ella el endpoint del cron responde 503 a su propia llamada.
    delete process.env.CRON_SECRET
    conUltimoRollup('2026-08-27')

    const body = await (await GET(req())).json()
    expect(body.checks.cron.ok).toBe(false)
    expect(body.checks.cron.detail).toContain('CRON_SECRET')
  })

  it('con el rollup al día, ok', async () => {
    process.env.CRON_SECRET = 'x'
    conUltimoRollup('2026-08-27')

    const body = await (await GET(req())).json()
    expect(body.checks.cron.ok).toBe(true)
    expect(body.checks.cron.detail).toContain('2026-08-27')
  })

  it('cuenta los días de atraso cuando el cron lleva tiempo caído', async () => {
    process.env.CRON_SECRET = 'x'
    conUltimoRollup('2026-08-23') // ayer es el 27 → 4 días

    const body = await (await GET(req())).json()
    expect(body.checks.cron.ok).toBe(false)
    expect(body.checks.cron.detail).toContain('4 día(s) de atraso')
  })

  it('sin ninguna consolidación previa, avisa igualmente', async () => {
    process.env.CRON_SECRET = 'x'
    conUltimoRollup(null)

    const body = await (await GET(req())).json()
    expect(body.checks.cron.ok).toBe(false)
    expect(body.checks.cron.detail).toContain('nunca')
  })

  it('un cron atrasado NO tumba el health global', async () => {
    // Los monitores de uptime miran el código HTTP. Un rollup con retraso
    // es un aviso de operación, no una caída del sitio: si devolviera 503
    // acabaría siendo ruido que se ignora.
    process.env.CRON_SECRET = 'x'
    conUltimoRollup('2026-08-01')

    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.checks.cron.ok).toBe(false)
  })
})

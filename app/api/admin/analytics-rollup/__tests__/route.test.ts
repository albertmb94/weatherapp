import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getCurrentAdminMock, runAnalyticsRollupMock } = vi.hoisted(() => ({
  getCurrentAdminMock: vi.fn(),
  runAnalyticsRollupMock: vi.fn(),
}))

vi.mock('@/lib/admin/auth', () => ({ getCurrentAdmin: getCurrentAdminMock }))
vi.mock('@/lib/analytics', () => ({ runAnalyticsRollup: runAnalyticsRollupMock }))

import { POST } from '@/app/api/admin/analytics-rollup/route'

describe('/api/admin/analytics-rollup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('sin sesión de admin responde 401 y NO ejecuta nada', async () => {
    getCurrentAdminMock.mockResolvedValue(null)

    const res = await POST()

    expect(res.status).toBe(401)
    // Lo importante no es el código, es que el rollup PURGA datos crudos:
    // no puede llegar a ejecutarse sin autorización.
    expect(runAnalyticsRollupMock).not.toHaveBeenCalled()
  })

  it('con sesión de admin ejecuta el rollup y devuelve su resultado', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    runAnalyticsRollupMock.mockResolvedValue({
      ok: true,
      days: 4,
      purgedViews: 120,
    })

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, days: 4, purgedViews: 120 })
  })

  it('un rollup fallido devuelve 500, no un 200 optimista', async () => {
    // El caso que importa: la consolidación quedó incompleta y por eso no
    // se purgó nada. Si esto respondiera 200, el panel diría "hecho" sobre
    // una consolidación que no ocurrió.
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    runAnalyticsRollupMock.mockResolvedValue({
      ok: false,
      reason: 'consolidación incompleta: quedan 2 día(s) sin rollup. NO se ha purgado nada.',
      purgeSkipped: true,
    })

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.purgeSkipped).toBe(true)
    expect(body.reason).toContain('NO se ha purgado nada')
  })

  it('no depende de CRON_SECRET: funciona justo cuando esa variable falta', async () => {
    // Es la razón de ser de la ruta. /api/cron/analytics-rollup responde
    // 503 sin la variable, así que sin este camino no había forma de
    // consolidar mientras se arreglaba la configuración.
    const previo = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    runAnalyticsRollupMock.mockResolvedValue({ ok: true, days: 1 })

    try {
      const res = await POST()
      expect(res.status).toBe(200)
      expect(runAnalyticsRollupMock).toHaveBeenCalled()
    } finally {
      if (previo === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = previo
    }
  })
})

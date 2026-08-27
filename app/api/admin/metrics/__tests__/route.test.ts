import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { currentAdmin, metrics } = vi.hoisted(() => ({
  currentAdmin: vi.fn(),
  metrics: vi.fn(),
}))

vi.mock('@/lib/admin/auth', () => ({ getCurrentAdmin: currentAdmin }))
vi.mock('@/lib/analytics', async () => {
  const real = await vi.importActual<typeof import('@/lib/analytics')>('@/lib/analytics')
  return { ...real, getAdminMetrics: metrics }
})

import { GET } from '@/app/api/admin/metrics/route'

const BASE = 'https://eltiempo.example/api/admin/metrics'
const req = (qs = '') => new NextRequest(`${BASE}${qs}`)

beforeEach(() => {
  currentAdmin.mockReset()
  metrics.mockReset()
  currentAdmin.mockResolvedValue('admin@example.com')
  metrics.mockResolvedValue({ ok: true, metrics: { rangeDays: 30 } })
})

describe('autenticación', () => {
  it('sin sesión de admin responde 401 y no consulta nada', async () => {
    currentAdmin.mockResolvedValue(null)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(metrics).not.toHaveBeenCalled()
  })
})

describe('parámetro range', () => {
  it('honra los rangos permitidos', async () => {
    for (const n of [7, 30, 90]) {
      await GET(req(`?range=${n}`))
      expect(metrics).toHaveBeenLastCalledWith(n)
    }
  })

  it('cae a 30 con valores no permitidos, ausentes o basura', async () => {
    // Antes estaba fijado a 30 a fuego e ignoraba el parámetro por
    // completo, pese a que `rangeDays` ya existía en el tipo.
    for (const v of ['', '?range=999', '?range=0', '?range=-7', '?range=abc']) {
      await GET(req(v))
      expect(metrics).toHaveBeenLastCalledWith(30)
    }
  })
})

describe('mapeo de errores', () => {
  it('"no configurada" es 503: es un problema de despliegue, no del servicio', async () => {
    metrics.mockResolvedValue({ ok: false, error: 'not_configured', detail: 'falta TURSO_DATABASE_URL' })
    const res = await GET(req())
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ ok: false, error: 'not_configured' })
  })

  it('"migraciones pendientes" también es 503', async () => {
    metrics.mockResolvedValue({ ok: false, error: 'schema_pending' })
    expect((await GET(req())).status).toBe(503)
  })

  it('una consulta rota SÍ es 500', async () => {
    metrics.mockResolvedValue({ ok: false, error: 'query_failed', detail: 'no such table: page_views' })
    const res = await GET(req())
    expect(res.status).toBe(500)
  })

  it('en el camino correcto devuelve las métricas', async () => {
    const res = await GET(req('?range=7'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, metrics: { rangeDays: 30 } })
  })
})

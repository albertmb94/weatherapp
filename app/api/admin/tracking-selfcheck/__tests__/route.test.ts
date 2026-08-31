import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { getCurrentAdminMock, selectOrThrowMock } = vi.hoisted(() => ({
  getCurrentAdminMock: vi.fn(),
  selectOrThrowMock: vi.fn(),
}))

vi.mock('@/lib/admin/auth', () => ({ getCurrentAdmin: getCurrentAdminMock }))
vi.mock('@/lib/db', () => ({ db: { selectOrThrow: selectOrThrowMock } }))

import { GET } from '@/app/api/admin/tracking-selfcheck/route'

/**
 * Autodiagnóstico de tracking.
 *
 * Responde a "¿por qué no aparecen MIS visitas?", que hasta ahora sólo se
 * podía resolver descartando causas a ciegas: no haber aceptado el
 * banner, un bloqueador, una versión antigua en caché — todas legítimas y
 * todas indistinguibles de un fallo desde el panel.
 *
 * Lo que estos tests fijan es el VEREDICTO (que no diga que se cuenta
 * cuando no) y que responderlo no filtre el pseudónimo de nadie.
 */

function pet(cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  return new NextRequest('http://localhost:3000/api/admin/tracking-selfcheck', {
    headers: cookie ? { cookie } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
  selectOrThrowMock.mockResolvedValue([{ n: 0, d: 0, ultima: null }])
})

describe('/api/admin/tracking-selfcheck', () => {
  it('exige sesión de admin', async () => {
    getCurrentAdminMock.mockResolvedValue(null)
    expect((await GET(pet())).status).toBe(401)
  })

  it('sin responder al banner: dice que NO se registra', async () => {
    const body = await (await GET(pet())).json()

    expect(body.navegador.seRegistra).toBe(false)
    expect(body.navegador.consentimiento).toBeNull()
  })

  it('con el banner RECHAZADO: tampoco se registra', async () => {
    const body = await (await GET(pet({ wthr_consent: 'rejected' }))).json()

    expect(body.navegador.seRegistra).toBe(false)
    expect(body.navegador.consentimiento).toBe('rejected')
  })

  it('con el banner aceptado: se registra', async () => {
    const body = await (await GET(pet({ wthr_consent: 'granted' }))).json()

    expect(body.navegador.seRegistra).toBe(true)
  })

  it('acepta el vocabulario antiguo de la cookie', async () => {
    // Las cookies duran un año: hay visitantes que aún llevan 'accept'.
    // Si el autodiagnóstico dijera que no se les cuenta, mandaría a
    // investigar un fallo que no existe.
    const body = await (await GET(pet({ wthr_consent: 'accept' }))).json()

    expect(body.navegador.seRegistra).toBe(true)
  })

  it('NO devuelve el anon_id, sólo si existe', async () => {
    selectOrThrowMock.mockResolvedValue([{ n: 3, d: 1, ultima: 1788000000000 }])

    const res = await GET(pet({ wthr_consent: 'granted', wthr_anon: 'a1b2c3d4e5f6' }))
    const texto = await res.text()

    expect(texto, 'el panel no necesita el pseudónimo de nadie').not.toContain('a1b2c3d4e5f6')
    expect(JSON.parse(texto).navegador.tieneIdentidad).toBe(true)
  })

  it('informa de la actividad de este dispositivo y del sitio', async () => {
    selectOrThrowMock.mockResolvedValue([{ n: 3, d: 2, ultima: 1788000000000 }])

    const body = await (await GET(pet({ wthr_consent: 'granted', wthr_anon: 'abc' }))).json()

    expect(body.esteDispositivo).toEqual({ vistasHoy: 3, ultima: 1788000000000 })
    expect(body.sitio).toEqual({ vistasHoy: 3, dispositivosHoy: 2, ultima: 1788000000000 })
  })

  it('sin identidad no consulta por dispositivo', async () => {
    const body = await (await GET(pet())).json()

    expect(body.esteDispositivo).toBeNull()
    // Sólo la consulta global.
    expect(selectOrThrowMock).toHaveBeenCalledTimes(1)
  })

  it('avisa cuando falta TRACK_INTERNAL_SECRET', async () => {
    const previo = process.env.TRACK_INTERNAL_SECRET
    delete process.env.TRACK_INTERNAL_SECRET
    try {
      const body = await (await GET(pet())).json()
      expect(body.bootstrapProxy).toBe(false)
    } finally {
      if (previo !== undefined) process.env.TRACK_INTERNAL_SECRET = previo
    }
  })

  it('un fallo de base devuelve 500, no un diagnóstico inventado', async () => {
    selectOrThrowMock.mockRejectedValue(new Error('base caída'))

    const res = await GET(pet())

    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const rollup = vi.hoisted(() => vi.fn())
vi.mock('@/lib/analytics', () => ({ runAnalyticsRollup: rollup }))

import { GET } from '@/app/api/cron/analytics-rollup/route'

const URL_CRON = 'https://eltiempo.example/api/cron/analytics-rollup'

function req(auth?: string): NextRequest {
  return new NextRequest(URL_CRON, { headers: auth ? { authorization: auth } : {} })
}

const ORIGINAL = process.env.CRON_SECRET

beforeEach(() => {
  rollup.mockReset()
  process.env.CRON_SECRET = 'secreto-cron'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = ORIGINAL
  vi.restoreAllMocks()
})

describe('autenticación', () => {
  it('sin CRON_SECRET configurado responde 503 (fail-closed)', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(req('Bearer lo-que-sea'))
    expect(res.status).toBe(503)
    expect(rollup).not.toHaveBeenCalled()
  })

  it('sin cabecera Authorization responde 401', async () => {
    expect((await GET(req())).status).toBe(401)
    expect(rollup).not.toHaveBeenCalled()
  })

  it('con un bearer incorrecto responde 401', async () => {
    expect((await GET(req('Bearer incorrecto'))).status).toBe(401)
    expect(rollup).not.toHaveBeenCalled()
  })

  it('con el bearer correcto ejecuta el rollup', async () => {
    rollup.mockResolvedValue({ ok: true, days: 2 })
    const res = await GET(req('Bearer secreto-cron'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, days: 2 })
  })
})

describe('propagación de fallos', () => {
  it('un rollup fallido devuelve 500, no un 200 optimista', async () => {
    // El motivo de que esto importe: `db.execute` devolvía false en vez
    // de lanzar, así que un rollup en el que fallaban TODAS las
    // sentencias reportaba { ok: true } y el cron respondía 200. Nadie
    // se enteraba nunca.
    rollup.mockResolvedValue({ ok: false, reason: 'consolidación incompleta', purgeSkipped: true })
    const res = await GET(req('Bearer secreto-cron'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.purgeSkipped).toBe(true)
  })
})

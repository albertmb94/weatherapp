import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

vi.hoisted(() => {
  process.env.TURSO_DATABASE_URL = 'file::memory:'
  delete process.env.TURSO_AUTH_TOKEN
})

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { runMigrations } from '@/lib/migrations'
import { POST } from '@/app/api/consent-stats/route'
import { getConsentStats } from '@/lib/analytics'

/**
 * Contador del banner de consentimiento, contra SQLite real.
 *
 * LO QUE MÁS SE PROTEGE AQUÍ NO ES EL RECUENTO, ES LA ANONIMIA: esta
 * ruta cuenta a gente que TODAVÍA NO HA CONSENTIDO. Si algún día empieza
 * a leer o escribir cookies, o a guardar la IP, se convierte en el
 * seguimiento sin permiso que el banner existe para evitar — y lo haría
 * en silencio.
 */

function pet(cuerpo: unknown, cabeceras: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/consent-stats', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', ...cabeceras },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  })
}

describe('/api/consent-stats', () => {
  beforeAll(async () => {
    await runMigrations()
  })

  beforeEach(async () => {
    await db.executeOrThrow('DELETE FROM consent_stats')
  })

  it('NO devuelve ninguna cookie', async () => {
    const res = await POST(pet({ e: 'shown' }))

    expect(res.status).toBe(204)
    expect(res.headers.get('set-cookie'), 'la respuesta no puede dar estado al dispositivo').toBeNull()
  })

  it('no guarda la IP ni ningún identificador: sólo día y evento', async () => {
    await POST(pet({ e: 'accept' }, { 'x-forwarded-for': '203.0.113.9' }))

    const filas = await db.selectOrThrow<Record<string, unknown>>('SELECT * FROM consent_stats')
    expect(filas).toHaveLength(1)
    // La forma de la fila ES la garantía: si aparece una columna más,
    // este test cae y obliga a justificarla.
    expect(Object.keys(filas[0]).sort()).toEqual(['count', 'day', 'event'])
    expect(JSON.stringify(filas[0])).not.toContain('203.0.113')
  })

  it('acumula por día y evento', async () => {
    await POST(pet({ e: 'shown' }))
    await POST(pet({ e: 'shown' }))
    await POST(pet({ e: 'accept' }))

    const stats = await getConsentStats(30)
    expect(stats).toMatchObject({ impresiones: 2, aceptadas: 1, rechazadas: 0, ignoradas: 1 })
    expect(stats?.tasa).toBeCloseTo(0.5)
  })

  it('rechaza un evento que no reconoce, sin escribir nada', async () => {
    const res = await POST(pet({ e: 'aceptar_todo' }))

    expect(res.status).toBe(400)
    const filas = await db.selectOrThrow('SELECT * FROM consent_stats')
    expect(filas).toHaveLength(0)
  })

  it('rechaza un cuerpo que no es JSON', async () => {
    expect((await POST(pet('esto-no-es-json'))).status).toBe(400)
  })

  it('sin impresiones la tasa es null, no cero', async () => {
    // Cero por ciento y "no hay dato" son cosas distintas: pintar 0%
    // sugiere que nadie acepta, cuando puede que nadie haya visto nada.
    const stats = await getConsentStats(30)
    expect(stats?.impresiones).toBe(0)
    expect(stats?.tasa).toBeNull()
  })

  it('nunca cuenta ignoradas negativas', async () => {
    // Una respuesta puede llegar sin su impresión si la pestaña se
    // recarga entre medias.
    await POST(pet({ e: 'accept' }))
    await POST(pet({ e: 'accept' }))

    const stats = await getConsentStats(30)
    expect(stats?.ignoradas).toBe(0)
  })
})

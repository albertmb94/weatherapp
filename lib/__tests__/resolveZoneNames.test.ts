import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'

vi.hoisted(() => {
  process.env.TURSO_DATABASE_URL = 'file::memory:'
  delete process.env.TURSO_AUTH_TOKEN
})

import { db } from '@/lib/db'
import { runMigrations } from '@/lib/migrations'
import { resolveZoneNames } from '@/lib/analytics'

/**
 * Nombrado de zonas bajo demanda, contra SQLite real.
 *
 * Lo que se protege es el COSTE: cada celda es una llamada a un servicio
 * externo, y `geo_names` es caché permanente precisamente para que se
 * pague una sola vez en la vida de esa celda. Si esto dejara de saltarse
 * las ya conocidas, abrir el panel repetiría las llamadas cada vez.
 */

function respuesta(cuerpo: unknown, ok = true) {
  return { ok, json: async () => cuerpo } as unknown as Response
}

const BDC = {
  city: 'Calella',
  principalSubdivision: 'Cataluña',
  countryName: 'España',
}

describe('resolveZoneNames', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeAll(async () => {
    await runMigrations()
  })

  beforeEach(async () => {
    await db.executeOrThrow('DELETE FROM geo_names')
    fetchMock = vi.fn(async () => respuesta(BDC))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resuelve una celda nueva y la guarda', async () => {
    const out = await resolveZoneNames(['41.61,2.65'])

    expect(out).toEqual({ '41.61,2.65': 'Calella · Cataluña' })
    const filas = await db.selectOrThrow<{ name: string }>(
      'SELECT name FROM geo_names WHERE cell = ?',
      ['41.61,2.65'],
    )
    expect(String(filas[0].name)).toBe('Calella · Cataluña')
  })

  it('NO vuelve a llamar al proveedor por una celda ya conocida', async () => {
    await resolveZoneNames(['41.61,2.65'])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await resolveZoneNames(['41.61,2.65'])
    expect(fetchMock, 'la caché es permanente: una llamada por celda').toHaveBeenCalledTimes(1)
  })

  it('de una lista mixta sólo pide las que faltan', async () => {
    await db.executeOrThrow(
      "INSERT INTO geo_names (cell, name, created_at) VALUES ('41.45,2.25', 'Badalona', 0)",
    )

    await resolveZoneNames(['41.45,2.25', '41.61,2.65'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('latitude=41.61')
  })

  it('descarta celdas inválidas sin llamar a nadie', async () => {
    const out = await resolveZoneNames(['no-es-una-celda', '95.00,2.00', ''])

    expect(out).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('acota por `limit`', async () => {
    const muchas = Array.from({ length: 20 }, (_, i) => `41.${String(i).padStart(2, '0')},2.65`)

    await resolveZoneNames(muchas, 3)

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('si el proveedor falla no cachea nada, para poder reintentar', async () => {
    fetchMock.mockResolvedValue(respuesta({}, false))

    const out = await resolveZoneNames(['41.61,2.65'])

    expect(out).toEqual({})
    const filas = await db.selectOrThrow('SELECT cell FROM geo_names')
    expect(filas.length, 'un fallo no debe fijarse en caché para siempre').toBe(0)
  })

  it('duplicados en la lista se piden una sola vez', async () => {
    await resolveZoneNames(['41.61,2.65', '41.61,2.65', '41.61,2.65'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getCurrentAdminMock, selectOrThrowMock, batchOrThrowMock } = vi.hoisted(() => ({
  getCurrentAdminMock: vi.fn(),
  selectOrThrowMock: vi.fn(),
  batchOrThrowMock: vi.fn(),
}))

vi.mock('@/lib/admin/auth', () => ({ getCurrentAdmin: getCurrentAdminMock }))
vi.mock('@/lib/db', () => ({
  db: { selectOrThrow: selectOrThrowMock, batchOrThrow: batchOrThrowMock },
}))

import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/admin/cleanup/geo-cell/route'

/** `contar()` hace 3 SELECT en paralelo: page_views, daily_breakdowns,
 *  geo_names. Se responde según la tabla que menciona el SQL. */
function conFilas(pv: number, bd: number, gn: number) {
  selectOrThrowMock.mockImplementation(async (sql: string) => {
    if (sql.includes('page_views')) return [{ n: pv }]
    if (sql.includes('daily_breakdowns')) return [{ n: bd }]
    if (sql.includes('geo_names')) return [{ n: gn }]
    throw new Error('SQL inesperado: ' + sql)
  })
}

/** Petición a la ruta, opcionalmente con `?cell=`. */
function pet(celda?: string): NextRequest {
  const u = new URL('http://localhost:3000/api/admin/cleanup/geo-cell')
  if (celda !== undefined) u.searchParams.set('cell', celda)
  return new NextRequest(u)
}

describe('/api/admin/cleanup/geo-null-island', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    batchOrThrowMock.mockResolvedValue(undefined)
  })

  it('sin sesión de admin no cuenta ni borra nada', async () => {
    getCurrentAdminMock.mockResolvedValue(null)

    expect((await GET(pet())).status).toBe(401)
    expect((await POST(pet())).status).toBe(401)
    // Lo que importa: la ruta MODIFICA datos de producción.
    expect(batchOrThrowMock).not.toHaveBeenCalled()
    expect(selectOrThrowMock).not.toHaveBeenCalled()
  })

  it('GET informa de las filas afectadas sin tocar nada', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(31, 3, 1)

    const body = await (await GET(pet())).json()

    expect(body).toEqual({
      ok: true,
      cell: '0.00,0.00',
      afectadas: { pageViews: 31, breakdowns: 3, geoNames: 1 },
    })
    expect(batchOrThrowMock).not.toHaveBeenCalled()
  })

  it('ANULA la zona de las visitas en vez de borrarlas', async () => {
    // La regla que no se puede romper: la visita ocurrió de verdad y sólo
    // la ubicación era falsa. Borrar la fila restaría vistas y
    // dispositivos reales del panel.
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(31, 3, 1)

    await POST(pet())

    const sentencias = batchOrThrowMock.mock.calls[0][0] as { sql: string }[]
    const dePageViews = sentencias.filter(s => s.sql.includes('page_views'))
    expect(dePageViews).toHaveLength(1)
    expect(dePageViews[0].sql).toMatch(/UPDATE page_views SET geo_cell = NULL/)
    expect(sentencias.some(s => /DELETE\s+FROM\s+page_views/i.test(s.sql))).toBe(false)
  })

  it('borra las filas DERIVADAS: desglose por zona y nombre cacheado', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(31, 3, 1)

    await POST(pet())

    const sqls = (batchOrThrowMock.mock.calls[0][0] as { sql: string }[]).map(s => s.sql)
    expect(sqls.some(s => /DELETE FROM daily_breakdowns/.test(s))).toBe(true)
    expect(sqls.some(s => /DELETE FROM geo_names/.test(s))).toBe(true)
  })

  it('todo va en UN lote: no puede quedar a medias', async () => {
    // Borrar el desglose y no anular las visitas (o al revés) dejaría el
    // panel incoherente.
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(31, 3, 1)

    await POST(pet())

    expect(batchOrThrowMock).toHaveBeenCalledTimes(1)
    expect(batchOrThrowMock.mock.calls[0][0]).toHaveLength(3)
  })

  it('siempre apunta a la celda 0.00,0.00, nunca a otra', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(31, 3, 1)

    await POST(pet())

    const sentencias = batchOrThrowMock.mock.calls[0][0] as { sql: string; args?: unknown[] }[]
    for (const s of sentencias) expect(s.args).toEqual(['0.00,0.00'])
  })

  it('un fallo de escritura devuelve 500, no un ok optimista', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(31, 3, 1)
    batchOrThrowMock.mockRejectedValue(new Error('turso caída'))

    const res = await POST(pet())

    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })

  it('es idempotente: una segunda pasada no encuentra nada', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(0, 0, 0)

    const body = await (await POST(pet())).json()

    expect(body.aplicado).toEqual({ pageViews: 0, breakdowns: 0, geoNames: 0 })
    expect(body.restante).toEqual({ pageViews: 0, breakdowns: 0, geoNames: 0 })
  })

  describe('validación del parámetro `cell`', () => {
    // Es lo único variable de la operación, así que es lo único que
    // podría convertirla en algo distinto de lo que dice hacer.
    beforeEach(() => {
      getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
      conFilas(2, 1, 0)
    })

    it('sin parámetro limpia Null Island por defecto', async () => {
      const body = await (await POST(pet())).json()
      expect(body.cell).toBe('0.00,0.00')
    })

    it('acepta una celda con el formato exacto que escribe la ingesta', async () => {
      const body = await (await POST(pet('37.39,-5.98'))).json()
      expect(body.cell).toBe('37.39,-5.98')
      const sentencias = batchOrThrowMock.mock.calls[0][0] as { args?: unknown[] }[]
      for (const s of sentencias) expect(s.args).toEqual(['37.39,-5.98'])
    })

    it.each([
      ['SQL en el parámetro', "0.00,0.00' OR '1'='1"],
      ['comodín', '%'],
      ['sin decimales fijos', '37.4,-5.9'],
      ['latitud fuera de rango', '95.00,2.00'],
      ['longitud fuera de rango', '41.00,-200.00'],
      ['vacío', ''],
      ['texto', 'Sevilla'],
    ])('rechaza %s sin tocar la base de datos', async (_caso, valor) => {
      const res = await POST(pet(valor))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('celda_invalida')
      expect(batchOrThrowMock).not.toHaveBeenCalled()
    })
  })
})

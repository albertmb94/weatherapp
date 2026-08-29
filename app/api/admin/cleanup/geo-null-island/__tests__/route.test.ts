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

import { GET, POST } from '@/app/api/admin/cleanup/geo-null-island/route'

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

describe('/api/admin/cleanup/geo-null-island', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    batchOrThrowMock.mockResolvedValue(undefined)
  })

  it('sin sesión de admin no cuenta ni borra nada', async () => {
    getCurrentAdminMock.mockResolvedValue(null)

    expect((await GET()).status).toBe(401)
    expect((await POST()).status).toBe(401)
    // Lo que importa: la ruta MODIFICA datos de producción.
    expect(batchOrThrowMock).not.toHaveBeenCalled()
    expect(selectOrThrowMock).not.toHaveBeenCalled()
  })

  it('GET informa de las filas afectadas sin tocar nada', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(31, 3, 1)

    const body = await (await GET()).json()

    expect(body).toEqual({ ok: true, afectadas: { pageViews: 31, breakdowns: 3, geoNames: 1 } })
    expect(batchOrThrowMock).not.toHaveBeenCalled()
  })

  it('ANULA la zona de las visitas en vez de borrarlas', async () => {
    // La regla que no se puede romper: la visita ocurrió de verdad y sólo
    // la ubicación era falsa. Borrar la fila restaría vistas y
    // dispositivos reales del panel.
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(31, 3, 1)

    await POST()

    const sentencias = batchOrThrowMock.mock.calls[0][0] as { sql: string }[]
    const dePageViews = sentencias.filter(s => s.sql.includes('page_views'))
    expect(dePageViews).toHaveLength(1)
    expect(dePageViews[0].sql).toMatch(/UPDATE page_views SET geo_cell = NULL/)
    expect(sentencias.some(s => /DELETE\s+FROM\s+page_views/i.test(s.sql))).toBe(false)
  })

  it('borra las filas DERIVADAS: desglose por zona y nombre cacheado', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(31, 3, 1)

    await POST()

    const sqls = (batchOrThrowMock.mock.calls[0][0] as { sql: string }[]).map(s => s.sql)
    expect(sqls.some(s => /DELETE FROM daily_breakdowns/.test(s))).toBe(true)
    expect(sqls.some(s => /DELETE FROM geo_names/.test(s))).toBe(true)
  })

  it('todo va en UN lote: no puede quedar a medias', async () => {
    // Borrar el desglose y no anular las visitas (o al revés) dejaría el
    // panel incoherente.
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(31, 3, 1)

    await POST()

    expect(batchOrThrowMock).toHaveBeenCalledTimes(1)
    expect(batchOrThrowMock.mock.calls[0][0]).toHaveLength(3)
  })

  it('siempre apunta a la celda 0.00,0.00, nunca a otra', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(31, 3, 1)

    await POST()

    const sentencias = batchOrThrowMock.mock.calls[0][0] as { sql: string; args?: unknown[] }[]
    for (const s of sentencias) expect(s.args).toEqual(['0.00,0.00'])
  })

  it('un fallo de escritura devuelve 500, no un ok optimista', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(31, 3, 1)
    batchOrThrowMock.mockRejectedValue(new Error('turso caída'))

    const res = await POST()

    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })

  it('es idempotente: una segunda pasada no encuentra nada', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    conFilas(0, 0, 0)

    const body = await (await POST()).json()

    expect(body.aplicado).toEqual({ pageViews: 0, breakdowns: 0, geoNames: 0 })
    expect(body.restante).toEqual({ pageViews: 0, breakdowns: 0, geoNames: 0 })
  })
})

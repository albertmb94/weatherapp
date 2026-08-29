import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

vi.hoisted(() => {
  process.env.TURSO_DATABASE_URL = 'file::memory:'
  delete process.env.TURSO_AUTH_TOKEN
})

const { getCurrentAdminMock } = vi.hoisted(() => ({ getCurrentAdminMock: vi.fn() }))
vi.mock('@/lib/admin/auth', () => ({ getCurrentAdmin: getCurrentAdminMock }))

import { db } from '@/lib/db'
import { runMigrations } from '@/lib/migrations'
import { getAdminMetrics } from '@/lib/analytics'
import { dayStartMs } from '@/lib/analytics/time'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/admin/cleanup/geo-cell/route'

/**
 * La limpieza corre contra la base de datos de PRODUCCIÓN, así que aquí
 * se ejecuta contra SQLite de verdad y no contra mocks.
 *
 * Lo que se protege: que saneando la ubicación NO se pierdan visitas. El
 * SQL que se propuso primero borraba las filas de `page_views`, y eso
 * habría restado vistas y dispositivos reales del panel — el problema
 * que se venía arrastrando, agravado por la propia limpieza.
 */

const HOY = '2026-08-27'
const NOW = Date.UTC(2026, 7, 27, 10, 0)
const CELDA = '0.00,0.00'

let seq = 0
async function visita(anon: string, geo: string | null): Promise<void> {
  await db.executeOrThrow(
    `INSERT INTO page_views
       (id, anon_id, path, country_code, locale, user_agent_browser,
        device_type, ts, day, session_id, geo_cell)
     VALUES (?, ?, '/', 'ES', 'es-ES', 'Chrome', 'desktop', ?, ?, ?, ?)`,
    [`row${++seq}`, anon, dayStartMs(HOY) + 12 * 3_600_000, HOY, `s-${anon}`, geo],
  )
}

/** Petición a la ruta, opcionalmente con `?cell=`. */
function pet(celda?: string): NextRequest {
  const u = new URL('http://localhost:3000/api/admin/cleanup/geo-cell')
  if (celda !== undefined) u.searchParams.set('cell', celda)
  return new NextRequest(u)
}

describe('limpieza de Null Island contra SQLite real', () => {
  beforeAll(async () => {
    await runMigrations()
  })

  beforeEach(async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    for (const t of ['page_views', 'daily_breakdowns', 'geo_names', 'daily_anon_stats']) {
      await db.executeOrThrow(`DELETE FROM ${t}`)
    }
    seq = 0
  })

  it('conserva TODAS las visitas y sólo les quita la zona', async () => {
    await visita('a', CELDA)
    await visita('a', CELDA)
    await visita('b', CELDA)
    await visita('c', '41.45,2.25') // otra zona: no debe tocarse

    const antes = await db.selectOrThrow<{ n: number }>('SELECT COUNT(*) AS n FROM page_views')
    expect(Number(antes[0].n)).toBe(4)

    await POST(pet())

    const despues = await db.selectOrThrow<{ n: number }>('SELECT COUNT(*) AS n FROM page_views')
    expect(Number(despues[0].n), 'no se borra ni una visita').toBe(4)

    const nulas = await db.selectOrThrow<{ n: number }>(
      'SELECT COUNT(*) AS n FROM page_views WHERE geo_cell IS NULL',
    )
    expect(Number(nulas[0].n)).toBe(3)

    const otra = await db.selectOrThrow<{ n: number }>(
      'SELECT COUNT(*) AS n FROM page_views WHERE geo_cell = ?',
      ['41.45,2.25'],
    )
    expect(Number(otra[0].n), 'las demás zonas quedan intactas').toBe(1)
  })

  it('el panel sigue contando las mismas vistas y dispositivos', async () => {
    await visita('a', CELDA)
    await visita('a', CELDA)
    await visita('b', CELDA)

    const antes = await getAdminMetrics(30, NOW)
    expect(antes.ok).toBe(true)

    await POST(pet())

    const despues = await getAdminMetrics(30, NOW)
    expect(despues.ok).toBe(true)
    if (!antes.ok || !despues.ok) throw new Error('métricas no disponibles')

    // ESTA es la aserción que justifica el diseño: sanear la ubicación no
    // puede cambiar ni una vista ni un dispositivo.
    //
    // Se comprueba primero que los valores NO son cero: con nombres de
    // campo inventados, `undefined === undefined` habría pasado en verde
    // sin probar nada (vitest no comprueba tipos; lo cazó `tsc`).
    expect(antes.metrics.today.views).toBe(3)
    expect(antes.metrics.today.devices).toBe(2)

    expect(despues.metrics.today.views).toBe(antes.metrics.today.views)
    expect(despues.metrics.today.devices).toBe(antes.metrics.today.devices)
    expect(despues.metrics.rangeDevices).toBe(antes.metrics.rangeDevices)

    // Y la zona errónea desaparece del desglose.
    expect(antes.metrics.zones.some(z => z.label === CELDA)).toBe(true)
    expect(despues.metrics.zones.some(z => z.label === CELDA)).toBe(false)
  })

  it('borra el desglose por zona y el nombre cacheado, y no otros', async () => {
    await db.executeOrThrow(
      `INSERT INTO daily_breakdowns (date, dim, label, views, devices) VALUES
         (?, 'geo_cell', ?, 20, 3), (?, 'geo_cell', '41.45,2.25', 10, 2),
         (?, 'path', '/', 30, 5)`,
      [HOY, CELDA, HOY, HOY],
    )
    await db.executeOrThrow(
      `INSERT INTO geo_names (cell, name, created_at) VALUES (?, 'océano Atlántico', 0), ('41.45,2.25', 'Badalona', 0)`,
      [CELDA],
    )

    await POST(pet())

    const zonas = await db.selectOrThrow<{ label: string }>(
      "SELECT label FROM daily_breakdowns WHERE dim = 'geo_cell'",
    )
    expect(zonas.map(z => String(z.label))).toEqual(['41.45,2.25'])

    const rutas = await db.selectOrThrow<{ n: number }>(
      "SELECT COUNT(*) AS n FROM daily_breakdowns WHERE dim = 'path'",
    )
    expect(Number(rutas[0].n), 'otros desgloses no se tocan').toBe(1)

    const nombres = await db.selectOrThrow<{ cell: string }>('SELECT cell FROM geo_names')
    expect(nombres.map(n => String(n.cell))).toEqual(['41.45,2.25'])
  })

  it('dos pasadas seguidas dejan lo mismo', async () => {
    await visita('a', CELDA)
    await db.executeOrThrow(
      `INSERT INTO geo_names (cell, name, created_at) VALUES (?, 'océano Atlántico', 0)`,
      [CELDA],
    )

    const primera = await (await POST(pet())).json()
    const segunda = await (await POST(pet())).json()

    expect(primera.aplicado).toEqual({ pageViews: 1, breakdowns: 0, geoNames: 1 })
    expect(segunda.aplicado).toEqual({ pageViews: 0, breakdowns: 0, geoNames: 0 })

    const total = await db.selectOrThrow<{ n: number }>('SELECT COUNT(*) AS n FROM page_views')
    expect(Number(total[0].n)).toBe(1)
  })
})

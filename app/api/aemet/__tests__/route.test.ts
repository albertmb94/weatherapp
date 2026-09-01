import { describe, it, expect, vi, beforeEach } from 'vitest'
import { REFRESH_WINDOW_MS } from '@/lib/refreshWindow'

const MOCK_AEMET_STATIONS = [
  {
    idema: '08001',
    ubi: 'BARCELONA',
    lat: 41.39,
    lon: 2.17,
    fint: '2026-06-04T10:00:00+0000',
    alt: 12,
    ta: 21.5,
    tamax: 24.0,
    tamin: 19.0,
    hr: 75,
    vv: 12.0,
    vmax: 28.0,
    dv: 180,
    prec: 0.0,
  },
]

vi.mock('@/lib/aemet', () => ({
  fetchAemetStations: vi.fn(),
  getStaleAemetStations: vi.fn().mockReturnValue(null),
}))

// Sprint 10 / B-10-5 (E6): the route now consults the shared Turso
// cache first. The test stubs those helpers to return null so the
// fallback path is exercised without hitting the real database.
vi.mock('@/lib/externalStationsCache', () => ({
  getFreshCachedStations: vi.fn().mockResolvedValue(null),
  getStaleCachedStations: vi.fn().mockResolvedValue(null),
  setCachedStations: vi.fn().mockResolvedValue(undefined),
  parseStationsPayload: vi.fn().mockReturnValue(null),
}))

import { GET } from '../route'
import { fetchAemetStations } from '@/lib/aemet'

function req(url: string) { return new Request(url) }

describe('/api/aemet GET', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns empty stations when API key not configured', async () => {
    const original = process.env.AEMET_API_KEY
    delete process.env.AEMET_API_KEY
    const res = await GET(req('http://localhost/api/aemet'))
    const body = await res.json()
    expect(body.stations).toEqual([])
    expect(body.error).toContain('not configured')
    process.env.AEMET_API_KEY = original
  })

  it('returns all stations', async () => {
    process.env.AEMET_API_KEY = 'test-key'
    vi.mocked(fetchAemetStations).mockResolvedValue(MOCK_AEMET_STATIONS)
    const res = await GET(req('http://localhost/api/aemet'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stations).toHaveLength(1)
    expect(body.stations[0].idema).toBe('08001')
    expect(body.stations[0].ubi).toBe('BARCELONA')
    expect(body.fetchedAt).toBeDefined()
  })

  it('returns 502 on fetch failure', async () => {
    process.env.AEMET_API_KEY = 'test-key'
    vi.mocked(fetchAemetStations).mockRejectedValue(new Error('AEMET fetch failed: 403'))
    const res = await GET(req('http://localhost/api/aemet'))
    expect(res.status).toBe(502)
  })

  it('la caché de CDN no dura menos que la de datos', async () => {
    // Antes esto fijaba `s-maxage=300` a pelo, y ese número era el
    // fallo, no el contrato. Cada fallo de caché de esta ruta lee y
    // parsea un blob de ~2,4 MB desde Turso para devolver 5 estaciones,
    // mientras que `externalStationsCache` considera frescos los datos
    // durante REFRESH_WINDOW_MS (2 h). Con 300 s el CDN volvía a
    // preguntar 24 veces por cada dato nuevo: ni una lectura más
    // fresca, sólo la lectura más cara del proyecto repetida.
    //
    // Lo que hay que preservar es la RELACIÓN: el CDN no debe caducar
    // antes que los datos que sirve.
    process.env.AEMET_API_KEY = 'test-key'
    vi.mocked(fetchAemetStations).mockResolvedValue([])
    const res = await GET(req('http://localhost/api/aemet'))
    const cc = res.headers.get('Cache-Control') ?? ''
    const sMaxAge = Number(cc.match(/s-maxage=(\d+)/)?.[1])
    expect(sMaxAge, `sin s-maxage en "${cc}"`).toBeGreaterThan(0)
    expect(sMaxAge * 1000).toBeGreaterThanOrEqual(REFRESH_WINDOW_MS)
  })
})

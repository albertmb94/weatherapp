import { describe, it, expect, vi, beforeEach } from 'vitest'

const MOCK_AEMET_STATIONS = [
  {
    idema: '08001',
    nombre: 'Barcelona',
    lat: 41.39,
    lon: 2.17,
    fint: '2026-06-04T10:00:00Z',
    tmed: 21.5,
    tmax: 24.0,
    tmin: 19.0,
    hum: 75,
    hum_max: 85,
    hum_min: 65,
    pres: 1013.2,
    pres_max: 1015.0,
    pres_min: 1011.5,
    velmedia: 12.0,
    racha: 28.0,
    dir: 180,
    prec: 0.0,
  },
]

vi.mock('@/lib/aemet', () => ({
  fetchAemetStations: vi.fn(),
  fetchAemetStation: vi.fn(),
}))

import { GET } from '../route'
import { fetchAemetStations, fetchAemetStation } from '@/lib/aemet'

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

  it('returns all stations when no station param', async () => {
    process.env.AEMET_API_KEY = 'test-key'
    vi.mocked(fetchAemetStations).mockResolvedValue(MOCK_AEMET_STATIONS)
    const res = await GET(req('http://localhost/api/aemet'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stations).toHaveLength(1)
    expect(body.stations[0].idema).toBe('08001')
    expect(body.fetchedAt).toBeDefined()
  })

  it('returns specific station when station param provided', async () => {
    process.env.AEMET_API_KEY = 'test-key'
    vi.mocked(fetchAemetStation).mockResolvedValue(MOCK_AEMET_STATIONS)
    const res = await GET(req('http://localhost/api/aemet?station=08001'))
    expect(res.status).toBe(200)
    expect(fetchAemetStation).toHaveBeenCalledWith('08001')
  })

  it('returns 502 on fetch failure', async () => {
    process.env.AEMET_API_KEY = 'test-key'
    vi.mocked(fetchAemetStations).mockRejectedValue(new Error('AEMET fetch failed: 403'))
    const res = await GET(req('http://localhost/api/aemet'))
    expect(res.status).toBe(502)
  })

  it('includes Cache-Control header', async () => {
    process.env.AEMET_API_KEY = 'test-key'
    vi.mocked(fetchAemetStations).mockResolvedValue([])
    const res = await GET(req('http://localhost/api/aemet'))
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=300')
  })
})

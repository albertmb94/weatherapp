import { describe, it, expect, vi, beforeEach } from 'vitest'

const MOCK_AEMET_STATIONS = [
  {
    idema: '08001',
    ubi: 'BARCELONA',
    lat: 41.39,
    lon: 2.17,
    fint: '2026-06-04T10:00:00+0000',
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

  it('includes Cache-Control header', async () => {
    process.env.AEMET_API_KEY = 'test-key'
    vi.mocked(fetchAemetStations).mockResolvedValue([])
    const res = await GET(req('http://localhost/api/aemet'))
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=300')
  })
})

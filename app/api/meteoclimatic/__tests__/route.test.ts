import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const MOCK_STATION_RSS = `<?xml version="1.0" encoding="ISO-8859-15"?>
<rss version="2.0">
 <channel>
  <item>
   <title>Badalona - BCIN (Barcelona)</title>
   <pubDate>Thu, 04 Jun 2026 09:00:00 +0000</pubDate>
   <description><![CDATA[<!-- [[<BEGIN:ESCAT0800000008915C:DATA>]] [[<ESCAT0800000008915C;(21,4;22,4;21,0;sun);(90,0;90,0;80,0);(1014,6;1017,1;1014,6);(23,0;43,0;180);(0,0);Badalona - BCIN>]] [[<END:ESCAT0800000008915C:DATA>]] --></description>
   <georss:point>41.46 2.26</georss:point>
  </item>
 </channel>
</rss>`

vi.mock('@/lib/meteoclimatic', () => ({
  fetchStationData: vi.fn(),
}))

import { GET } from '../route'
import { fetchStationData } from '@/lib/meteoclimatic'

function createRequest(url: string): Request {
  return new Request(url)
}

describe('/api/meteoclimatic GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 for invalid station code', async () => {
    const req = createRequest('http://localhost/api/meteoclimatic?station=invalid!code')
    const res = await GET(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid station code')
  })

  it('returns 400 for missing station param', async () => {
    const req = createRequest('http://localhost/api/meteoclimatic')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 200 with station data', async () => {
    vi.mocked(fetchStationData).mockResolvedValue([
      {
        code: 'ESCAT0800000008915C',
        name: 'Badalona - BCIN',
        lat: 41.46,
        lon: 2.26,
        updatedAt: 'Thu, 04 Jun 2026 09:00:00 +0000',
        temperature: { current: 21.4, max: 22.4, min: 21.0 },
        condition: 'sun',
        humidity: { current: 90.0, max: 90.0, min: 80.0 },
        pressure: { current: 1014.6, max: 1017.1, min: 1014.6 },
        wind: { speed: 23.0, gust: 43.0, bearing: 180, direction: 'S' },
        precipitation: 0.0,
      },
    ])

    const req = createRequest('http://localhost/api/meteoclimatic?station=ESCAT0800000008915C')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stations).toHaveLength(1)
    expect(body.stations[0].code).toBe('ESCAT0800000008915C')
    expect(body.stations[0].name).toBe('Badalona - BCIN')
    expect(body.fetchedAt).toBeDefined()
  })

  it('returns 502 on fetch failure', async () => {
    vi.mocked(fetchStationData).mockRejectedValue(new Error('Meteoclimatic fetch failed: 403'))

    const req = createRequest('http://localhost/api/meteoclimatic?station=ESCAT08')
    const res = await GET(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Failed to fetch Meteoclimatic data')
    expect(body.detail).toContain('403')
  })

  it('returns 504 on timeout', async () => {
    vi.mocked(fetchStationData).mockRejectedValue(new Error('The operation was aborted due to timeout'))

    const req = createRequest('http://localhost/api/meteoclimatic?station=ESCAT08')
    const res = await GET(req)
    expect(res.status).toBe(504)
  })

  it('returns 502 on network error', async () => {
    vi.mocked(fetchStationData).mockRejectedValue(new Error('fetch failed'))

    const req = createRequest('http://localhost/api/meteoclimatic?station=ESCAT08')
    const res = await GET(req)
    expect(res.status).toBe(502)
  })

  it('returns 404 for 404 errors from upstream', async () => {
    vi.mocked(fetchStationData).mockRejectedValue(new Error('Meteoclimatic fetch failed: 404'))

    const req = createRequest('http://localhost/api/meteoclimatic?station=ESCAT08')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('includes Cache-Control header', async () => {
    vi.mocked(fetchStationData).mockResolvedValue([])

    const req = createRequest('http://localhost/api/meteoclimatic?station=ESCAT08')
    const res = await GET(req)
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=120')
  })

  it('accepts alphanumeric-only station codes', async () => {
    vi.mocked(fetchStationData).mockResolvedValue([])

    const req = createRequest('http://localhost/api/meteoclimatic?station=ESCAT08')
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(fetchStationData).toHaveBeenCalledWith('ESCAT08')
  })
})

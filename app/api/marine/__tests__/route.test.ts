import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/cacheKey', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cacheKey')>('@/lib/cacheKey')
  return {
    ...actual,
    buildMarineCacheKey: vi.fn(() => 'test-marine-cache-key'),
  }
})

vi.mock('@/lib/marineCache', () => ({
  getCachedMarine: vi.fn(),
  getCachedMarineStale: vi.fn(),
  setCachedMarine: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(() => true),
}))

import { GET } from '@/app/api/marine/route'
import { getCachedMarine, getCachedMarineStale, setCachedMarine } from '@/lib/marineCache'
import { rateLimit } from '@/lib/rateLimit'

function createRequest(url: string, headers?: Record<string, string>): Request {
  return new Request(url, { headers })
}

describe('/api/marine GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(rateLimit).mockReturnValue(true)
    vi.mocked(getCachedMarine).mockResolvedValue(null)
    vi.mocked(getCachedMarineStale).mockResolvedValue(null)
  })

  it('returns 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue(false)
    const req = createRequest('http://localhost/api/marine?hourly=wave_height&latitude=41.39&longitude=2.17')
    const res = await GET(req)
    expect(res.status).toBe(429)
  })

  it('returns cached marine on cache hit', async () => {
    vi.mocked(getCachedMarine).mockResolvedValue({
      body: '{"hourly":{"time":["2026-01-01"]}}',
      fetchedAt: Date.now(),
      ageMs: 1000,
    })

    const req = createRequest('http://localhost/api/marine?hourly=wave_height&latitude=41.39&longitude=2.17')
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Marine-Cache')).toBe('hit')
  })

  it('returns stale cache when origin fails', async () => {
    vi.mocked(getCachedMarine).mockResolvedValue(null)
    vi.mocked(getCachedMarineStale).mockResolvedValue({
      body: '{"hourly":{"time":["2026-01-01"]}}',
      fetchedAt: Date.now(),
      ageMs: 5000,
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service unavailable'),
    }))

    const req = createRequest('http://localhost/api/marine?hourly=wave_height&latitude=41.39&longitude=2.17')
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Marine-Cache')).toBe('stale')
  })

  it('forwards request to marine-api.open-meteo.com', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"hourly":{"time":["2026-01-01"],"wave_height":[0.5]}}'),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const req = createRequest('http://localhost/api/marine?hourly=wave_height&latitude=41.39&longitude=2.17')
    await GET(req)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string
    expect(calledUrl).toContain('marine-api.open-meteo.com/v1/marine')
  })

  it('stores sanitized response in cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"hourly":{"time":["2026-01-01"],"wave_height":[0.5]}}'),
    }))

    const req = createRequest('http://localhost/api/marine?hourly=wave_height&latitude=41.39&longitude=2.17')
    await GET(req)
    expect(setCachedMarine).toHaveBeenCalled()
  })

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"hourly":{"time":["2026-01-01"],"wave_height":[0.5,0.6]}}'),
    }))

    const req = createRequest('http://localhost/api/marine?hourly=wave_height&latitude=41.39&longitude=2.17')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.hourly.wave_height).toEqual([0.5, 0.6])
  })

  it('sanitizes NaN values in response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"hourly":{"time":["2026-01-01"],"wave_height": nan}}'),
    }))

    const req = createRequest('http://localhost/api/marine?hourly=wave_height&latitude=41.39&longitude=2.17')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.hourly.wave_height).toBeNull()
  })
})

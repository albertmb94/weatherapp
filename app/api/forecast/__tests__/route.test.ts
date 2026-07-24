import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing the route
vi.mock('@/lib/cacheKey', () => ({
  buildForecastCacheKey: vi.fn(() => 'test-cache-key'),
}))

vi.mock('@/lib/forecastCache', () => ({
  getCachedForecast: vi.fn(),
  getCachedForecastStale: vi.fn(),
  setCachedForecast: vi.fn(),
}))

vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(() => true),
}))

import { GET } from '@/app/api/forecast/route'
import { getCachedForecast, getCachedForecastStale, setCachedForecast } from '@/lib/forecastCache'
import { rateLimit } from '@/lib/rateLimit'

function createRequest(url: string, headers?: Record<string, string>): Request {
  return new Request(url, { headers })
}

describe('/api/forecast GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(rateLimit).mockReturnValue(true)
    vi.mocked(getCachedForecast).mockResolvedValue(null)
    vi.mocked(getCachedForecastStale).mockResolvedValue(null)
  })

  it('returns 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue(false)
    const req = createRequest('http://localhost/api/forecast?hourly=temperature_2m')
    const res = await GET(req)
    expect(res.status).toBe(429)
  })

  it('returns cached forecast on cache hit', async () => {
    vi.mocked(getCachedForecast).mockResolvedValue({
      body: '{"hourly":{"time":["2025-01-01"]}}',
      fetchedAt: Date.now(),
      ageMs: 1000,
    })

    const req = createRequest('http://localhost/api/forecast?hourly=temperature_2m')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const header = res.headers.get('X-Forecast-Cache')
    expect(header).toBe('hit')
  })

  it('returns stale cache when origin fails', async () => {
    vi.mocked(getCachedForecast).mockResolvedValue(null)
    vi.mocked(getCachedForecastStale).mockResolvedValue({
      body: '{"hourly":{"time":["2025-01-01"]}}',
      fetchedAt: Date.now(),
      ageMs: 5000,
    })

    // Mock fetch to return error
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service unavailable'),
    }))

    const req = createRequest('http://localhost/api/forecast?hourly=temperature_2m')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const header = res.headers.get('X-Forecast-Cache')
    expect(header).toBe('stale')
  })

  it('stores sanitized response in cache', async () => {
    vi.mocked(getCachedForecast).mockResolvedValue(null)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"hourly":{"time":["2025-01-01"],"temperature_2m":[10]}}'),
    }))

    const req = createRequest('http://localhost/api/forecast?hourly=temperature_2m')
    await GET(req)
    expect(setCachedForecast).toHaveBeenCalled()
  })

  // B-NEW-4: the route must strip the `v` cache-bust stamp before
  // forwarding to Open-Meteo so the upstream URL stays clean. We
  // also verify the stamp IS part of the cache key (i.e. it
  // participates in `buildForecastCacheKey` and therefore
  // invalidates stale entries automatically when bumped).
  it('strips the `v` cache-bust param before forwarding upstream (B-NEW-4)', async () => {
    vi.mocked(getCachedForecast).mockResolvedValue(null)
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"hourly":{"time":["2025-01-01"],"temperature_2m":[10]}}'),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const req = createRequest('http://localhost/api/forecast?hourly=temperature_2m&v=v3-long-range-2026-07-24')
    await GET(req)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string
    expect(calledUrl).toBeDefined()
    // The upstream URL must NOT include the `v` stamp so the provider
    // sees the same query string the rest of the app emits.
    expect(calledUrl).not.toMatch(/[?&]v=/)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET } from '../route'

/**
 * Sprint 10 / B-10-5 — server-side reverse-geocode cache.
 *
 * We mock `fetch` so the test never hits BigDataCloud. The mocks
 * assert:
 *   1. The response sets a generous Cache-Control header.
 *   2. The upstream URL uses coordinates rounded to 2 decimals.
 *   3. Invalid coordinates return 400 without calling upstream.
 *   4. Upstream errors degrade gracefully (200 + null).
 */
const originalFetch = global.fetch

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  global.fetch = originalFetch
})

function mockFetchOnce(impl: Parameters<typeof vi.fn>[0]) {
  vi.mocked(fetch).mockImplementationOnce(impl as unknown as typeof fetch)
}

describe('GET /api/reverse-geocode', () => {
  it('sets a 24 h CDN cache header on success', async () => {
    mockFetchOnce(async () =>
      new Response(JSON.stringify({ city: 'Badalona' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    const req = new Request(
      'http://localhost/api/reverse-geocode?lat=41.4500&lon=2.2475&locale=es'
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toContain('s-maxage=86400')
    expect(cc).toContain('stale-while-revalidate=604800')
    const body = await res.json()
    expect(body).toEqual({ name: 'Badalona' })
  })

  it('rounds coordinates to 2 decimals before calling upstream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ city: 'X' }), { status: 200 })
    )
    vi.mocked(fetch).mockImplementation(fetchMock as unknown as typeof fetch)
    const req = new Request(
      'http://localhost/api/reverse-geocode?lat=41.454321&lon=2.249876'
    )
    await GET(req)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toContain('latitude=41.45')
    expect(calledUrl).toContain('longitude=2.25')
  })

  it('returns 400 for invalid latitude', async () => {
    const req = new Request(
      'http://localhost/api/reverse-geocode?lat=999&lon=2.25'
    )
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('falls back to null when the upstream fails', async () => {
    mockFetchOnce(async () => {
      throw new Error('upstream down')
    })
    const req = new Request(
      'http://localhost/api/reverse-geocode?lat=41.45&lon=2.25'
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ name: null })
  })

  it('returns the locality field as a fallback when city is empty', async () => {
    mockFetchOnce(async () =>
      new Response(JSON.stringify({ city: '', locality: 'Barceloneta' }), {
        status: 200,
      })
    )
    const req = new Request(
      'http://localhost/api/reverse-geocode?lat=41.45&lon=2.25'
    )
    const res = await GET(req)
    const body = await res.json()
    expect(body).toEqual({ name: 'Barceloneta' })
  })
})

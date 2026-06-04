import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(() => true),
}))

import { GET } from '@/app/api/geocode/route'
import { rateLimit } from '@/lib/rateLimit'

function createRequest(url: string): Request {
  return new Request(url)
}

describe('/api/geocode GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(rateLimit).mockReturnValue(true)
  })

  it('returns 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue(false)
    const req = createRequest('http://localhost/api/geocode?name=Madrid')
    const res = await GET(req)
    expect(res.status).toBe(429)
  })

  it('proxies geocoding request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [{ name: 'Madrid' }] }),
    }))

    const req = createRequest('http://localhost/api/geocode?name=Madrid')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.results).toHaveLength(1)
  })

  it('returns 500 on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    const req = createRequest('http://localhost/api/geocode?name=Madrid')
    const res = await GET(req)
    expect(res.status).toBe(500)
  })
})

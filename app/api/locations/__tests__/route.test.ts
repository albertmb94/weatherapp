import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/locations', () => ({
  getSavedLocations: vi.fn(),
  saveLocation: vi.fn(),
  deleteLocation: vi.fn(),
}))

vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(() => true),
}))

import { GET, POST, DELETE } from '@/app/api/locations/route'
import { getSavedLocations, saveLocation, deleteLocation } from '@/lib/locations'
import { rateLimit } from '@/lib/rateLimit'

function createRequest(url: string, options?: RequestInit): Request {
  return new Request(url, options)
}

describe('/api/locations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(rateLimit).mockReturnValue(true)
  })

  describe('GET', () => {
    it('returns saved locations', async () => {
      vi.mocked(getSavedLocations).mockResolvedValue([
        { id: 1, name: 'Madrid', latitude: 40.4, longitude: -3.7, created_at: '2025-01-01' },
      ])

      const req = createRequest('http://localhost/api/locations')
      const res = await GET(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveLength(1)
      expect(data[0].name).toBe('Madrid')
    })

    it('returns 429 when rate limited', async () => {
      vi.mocked(rateLimit).mockReturnValue(false)
      const req = createRequest('http://localhost/api/locations')
      const res = await GET(req)
      expect(res.status).toBe(429)
    })

    it('returns 500 on error', async () => {
      vi.mocked(getSavedLocations).mockRejectedValue(new Error('DB error'))
      const req = createRequest('http://localhost/api/locations')
      const res = await GET(req)
      expect(res.status).toBe(500)
    })
  })

  describe('POST', () => {
    it('creates a new location', async () => {
      vi.mocked(saveLocation).mockResolvedValue(1 as unknown as bigint)
      const req = createRequest('http://localhost/api/locations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Barcelona', latitude: 41.4, longitude: 2.2 }),
      })
      const res = await POST(req)
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.id).toBeDefined()
    })

    it('returns 400 for missing fields', async () => {
      const req = createRequest('http://localhost/api/locations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Barcelona' }),
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
    })

    it('M10: rejects stringified latitude (was TypeError on toFixed in client)', async () => {
      const req = createRequest('http://localhost/api/locations', {
        method: 'POST',
        body: JSON.stringify({ name: 'X', latitude: '41.4', longitude: 2.2 }),
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
    })

    it('M10: rejects out-of-range latitude', async () => {
      const req = createRequest('http://localhost/api/locations', {
        method: 'POST',
        body: JSON.stringify({ name: 'X', latitude: 95, longitude: 2.2 }),
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
    })

    it('M10: rejects oversized name (DoS protection)', async () => {
      const req = createRequest('http://localhost/api/locations', {
        method: 'POST',
        body: JSON.stringify({ name: 'a'.repeat(201), latitude: 41.4, longitude: 2.2 }),
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE', () => {
    it('deletes a location', async () => {
      vi.mocked(deleteLocation).mockResolvedValue(undefined)
      const req = createRequest('http://localhost/api/locations?id=1')
      const res = await DELETE(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
    })

    it('returns 400 for missing id', async () => {
      const req = createRequest('http://localhost/api/locations')
      const res = await DELETE(req)
      expect(res.status).toBe(400)
    })

    it('M10: rejects non-numeric id', async () => {
      const req = createRequest('http://localhost/api/locations?id=abc; DROP TABLE')
      const res = await DELETE(req)
      expect(res.status).toBe(400)
    })
  })
})

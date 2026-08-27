import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/appState', () => ({
  getRefreshStatus: vi.fn(),
  recordRefresh: vi.fn(),
}))

vi.mock('@/lib/forecastCache', () => ({
  purgeAllForecastCache: vi.fn(),
}))

vi.mock('@/lib/marineCache', () => ({
  purgeAllMarineCache: vi.fn(),
}))

// El limiter real es un token-bucket en memoria compartido entre tests;
// lo sustituimos por uno controlado para poder probar cada rama.
const { rateLimitMock } = vi.hoisted(() => ({
  rateLimitMock: vi.fn((_k: string, _m?: number, _w?: number) => true),
}))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: rateLimitMock }))

import { GET, POST } from '@/app/api/refresh/route'
import { getRefreshStatus, recordRefresh } from '@/lib/appState'
import { purgeAllForecastCache } from '@/lib/forecastCache'
import { purgeAllMarineCache } from '@/lib/marineCache'

function postReq(): NextRequest {
  // Sin Origin ni Sec-Fetch-Site → el check same-origin lo permite
  // (caller server-to-server); los tests de cross-origin van aparte.
  return new NextRequest('http://localhost:3000/api/refresh', { method: 'POST' })
}

describe('/api/refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMock.mockReturnValue(true)
  })

  describe('GET', () => {
    it('returns refresh status', async () => {
      vi.mocked(getRefreshStatus).mockResolvedValue({
        lastRefreshedAt: Date.now(),
        ageMs: 1000,
        canRefresh: true,
        cooldownMs: 7_200_000,
      })

      const res = await GET()
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.canRefresh).toBe(true)
    })

    it('returns 500 on error', async () => {
      vi.mocked(getRefreshStatus).mockRejectedValue(new Error('DB error'))
      const res = await GET()
      expect(res.status).toBe(500)
    })
  })

  describe('POST', () => {
    it('rejects cross-origin requests', async () => {
      const req = new NextRequest('http://localhost:3000/api/refresh', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      })
      const res = await POST(req)
      expect(res.status).toBe(403)
    })

    it('skips refresh when in cooldown', async () => {
      vi.mocked(getRefreshStatus).mockResolvedValue({
        lastRefreshedAt: Date.now(),
        ageMs: 1000,
        canRefresh: false,
        cooldownMs: 7_200_000,
      })

      const res = await POST(postReq())
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.skipped).toBe(true)
      expect(data.reason).toBe('cooldown')
    })

    it('performs refresh when cooldown has passed', async () => {
      vi.mocked(getRefreshStatus).mockResolvedValue({
        lastRefreshedAt: Date.now() - 7_200_000,
        ageMs: 7_200_000,
        canRefresh: true,
        cooldownMs: 7_200_000,
      })
      vi.mocked(recordRefresh).mockResolvedValue(Date.now())

      const res = await POST(postReq())
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.skipped).toBe(false)
      expect(recordRefresh).toHaveBeenCalled()
    })

    it('purges forecast cache after refresh', async () => {
      vi.mocked(getRefreshStatus).mockResolvedValue({
        lastRefreshedAt: null,
        ageMs: null,
        canRefresh: true,
        cooldownMs: 7_200_000,
      })
      vi.mocked(recordRefresh).mockResolvedValue(Date.now())

      await POST(postReq())
      expect(purgeAllForecastCache).toHaveBeenCalled()
    })

    it('M7: purges marine cache after refresh', async () => {
      vi.mocked(getRefreshStatus).mockResolvedValue({
        lastRefreshedAt: null,
        ageMs: null,
        canRefresh: true,
        cooldownMs: 7_200_000,
      })
      vi.mocked(recordRefresh).mockResolvedValue(Date.now())

      await POST(postReq())
      expect(purgeAllMarineCache).toHaveBeenCalled()
    })

    it('rate-limits abusive callers', async () => {
      rateLimitMock.mockReturnValue(false)
      const res = await POST(postReq())
      expect(res.status).toBe(429)
      expect(getRefreshStatus).not.toHaveBeenCalled()
    })

    it('returns 500 on error', async () => {
      vi.mocked(getRefreshStatus).mockRejectedValue(new Error('DB error'))
      const res = await POST(postReq())
      expect(res.status).toBe(500)
    })
  })
})

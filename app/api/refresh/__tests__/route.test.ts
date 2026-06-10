import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { GET, POST } from '@/app/api/refresh/route'
import { getRefreshStatus, recordRefresh } from '@/lib/appState'
import { purgeAllForecastCache } from '@/lib/forecastCache'
import { purgeAllMarineCache } from '@/lib/marineCache'

describe('/api/refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('returns refresh status', async () => {
      vi.mocked(getRefreshStatus).mockResolvedValue({
        lastRefreshedAt: Date.now(),
        ageMs: 1000,
        canRefresh: true,
        cooldownMs: 14400000,
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
    it('skips refresh when in cooldown', async () => {
      vi.mocked(getRefreshStatus).mockResolvedValue({
        lastRefreshedAt: Date.now(),
        ageMs: 1000,
        canRefresh: false,
        cooldownMs: 14400000,
      })

      const res = await POST()
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.skipped).toBe(true)
      expect(data.reason).toBe('cooldown')
    })

    it('performs refresh when cooldown has passed', async () => {
      vi.mocked(getRefreshStatus).mockResolvedValue({
        lastRefreshedAt: Date.now() - 14400000,
        ageMs: 14400000,
        canRefresh: true,
        cooldownMs: 14400000,
      })
      vi.mocked(recordRefresh).mockResolvedValue(Date.now())

      const res = await POST()
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
        cooldownMs: 14400000,
      })
      vi.mocked(recordRefresh).mockResolvedValue(Date.now())

      await POST()
      expect(purgeAllForecastCache).toHaveBeenCalled()
    })

    it('M7: purges marine cache after refresh', async () => {
      vi.mocked(getRefreshStatus).mockResolvedValue({
        lastRefreshedAt: null,
        ageMs: null,
        canRefresh: true,
        cooldownMs: 14400000,
      })
      vi.mocked(recordRefresh).mockResolvedValue(Date.now())

      await POST()
      expect(purgeAllMarineCache).toHaveBeenCalled()
    })

    it('returns 500 on error', async () => {
      vi.mocked(getRefreshStatus).mockRejectedValue(new Error('DB error'))
      const res = await POST()
      expect(res.status).toBe(500)
    })
  })
})

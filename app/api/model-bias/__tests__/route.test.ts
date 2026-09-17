import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(() => true) }))

vi.mock('@/lib/backtest/db', () => ({
  getBiasByTerrain: vi.fn(async () => ({
    temperature: { '0-48h': { ecmwf_ifs: 0.9 } },
  })),
}))

import { GET } from '@/app/api/model-bias/route'
import { rateLimit } from '@/lib/rateLimit'
import { getBiasByTerrain } from '@/lib/backtest/db'

function req(url: string): Request {
  return new Request(url)
}

describe('/api/model-bias GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(rateLimit).mockReturnValue(true)
    vi.mocked(getBiasByTerrain).mockResolvedValue({
      temperature: { '0-48h': { ecmwf_ifs: 0.9 } },
    })
  })

  it('returns 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue(false)
    const res = await GET(req('http://localhost/api/model-bias?terrain=coastal'))
    expect(res.status).toBe(429)
  })

  it('rejects an unknown terrain', async () => {
    const res = await GET(req('http://localhost/api/model-bias?terrain=mars'))
    expect(res.status).toBe(400)
    expect(getBiasByTerrain).not.toHaveBeenCalled()
  })

  it('returns the bias table for a valid terrain', async () => {
    const res = await GET(req('http://localhost/api/model-bias?terrain=coastal'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.terrain).toBe('coastal')
    expect(data.bias.temperature['0-48h'].ecmwf_ifs).toBe(0.9)
  })

  it('degrades to an empty table when the DB read throws', async () => {
    vi.mocked(getBiasByTerrain).mockRejectedValue(new Error('db down'))
    const res = await GET(req('http://localhost/api/model-bias?terrain=urban'))
    expect(res.status).toBe(200)
    expect((await res.json()).bias).toEqual({})
  })
})

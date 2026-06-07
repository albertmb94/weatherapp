import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn(),
}))

import { fetchMarine, computeMarineDays, MARINE_API_DAYS_MAX } from '../marine'
import { fetchWithTimeout } from '../fetchWithTimeout'
import { METRICS } from '../models'

describe('computeMarineDays', () => {
  it('rounds hours up to whole days, clamped to at least 1', () => {
    expect(computeMarineDays(1)).toBe(1)
    expect(computeMarineDays(24)).toBe(1)
    expect(computeMarineDays(25)).toBe(2)
    expect(computeMarineDays(48)).toBe(2)
    expect(computeMarineDays(168)).toBe(7)
  })

  it('caps at the marine API maximum (7 days)', () => {
    expect(computeMarineDays(1000)).toBe(MARINE_API_DAYS_MAX)
  })
})

describe('fetchMarine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests only marine metrics from the internal proxy', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        hourly: {
          time: ['2026-01-01T00:00', '2026-01-01T01:00'],
          wave_height: [0.5, 0.6],
          wave_period: [6, 7],
        },
        utc_offset_seconds: 0,
      }),
    } as Response)

    await fetchMarine(41.39, 2.17, METRICS, 2)

    const calledUrl = vi.mocked(fetchWithTimeout).mock.calls[0]?.[0] as string
    expect(calledUrl).toContain('/api/marine?')
    expect(calledUrl).toContain('wave_height')
    expect(calledUrl).toContain('wave_period')
    expect(calledUrl).toContain('forecast_days=2')
    expect(calledUrl).not.toContain('temperature_2m')
  })

  it('returns a single marine_global series keyed by metric id', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        hourly: {
          time: ['2026-01-01T00:00', '2026-01-01T01:00'],
          wave_height: [0.5, 0.6],
          wave_period: [6, 7],
          swell_wave_height: [0.2, 0.3],
        },
        utc_offset_seconds: 3600,
      }),
    } as Response)

    const result = await fetchMarine(41.39, 2.17, METRICS, 1)

    expect(Object.keys(result.series)).toEqual(['marine_global'])
    expect(result.series.marine_global.wave_height).toEqual([0.5, 0.6])
    expect(result.series.marine_global.wave_period).toEqual([6, 7])
    expect(result.series.marine_global.swell_wave_height).toEqual([0.2, 0.3])
    expect(result.time).toHaveLength(2)
    expect(result.utcOffsetSeconds).toBe(3600)
  })

  it('throws on non-OK response', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: false,
      status: 503,
    } as Response)

    await expect(fetchMarine(0, 0, METRICS, 1)).rejects.toThrow(/Marine API error/)
  })

  it('omits non-marine metrics from the request', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        hourly: { time: ['2026-01-01T00:00'], wave_height: [0.5] },
      }),
    } as Response)

    await fetchMarine(0, 0, METRICS, 1)
    const url = vi.mocked(fetchWithTimeout).mock.calls[0]?.[0] as string
    expect(url).not.toContain('temperature_2m')
    expect(url).not.toContain('wind_speed_10m')
  })
})

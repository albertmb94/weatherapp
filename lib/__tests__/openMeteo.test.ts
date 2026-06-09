import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn(),
}))

vi.mock('@/lib/marine', () => ({
  fetchMarine: vi.fn(),
  computeMarineDays: vi.fn(() => 7),
}))

import { computeForecastDays, fetchForecast, UV_MIN_FORECAST_DAYS } from '../openMeteo'
import { fetchWithTimeout } from '../fetchWithTimeout'
import { fetchMarine } from '../marine'
import { METRICS, MODELS } from '../models'

describe('computeForecastDays', () => {
  it('returns at least the UV minimum for sub-7-day ranges so UV is never dropped', () => {
    expect(computeForecastDays(24, 16)).toBe(UV_MIN_FORECAST_DAYS)
    expect(computeForecastDays(48, 16)).toBe(UV_MIN_FORECAST_DAYS)
    expect(computeForecastDays(72, 16)).toBe(UV_MIN_FORECAST_DAYS)
  })

  it('rounds up partial days (e.g. 25h → 2d, then clamped to UV min)', () => {
    // 25h rounds up to 2 days, but 2 < UV_MIN_FORECAST_DAYS, so the floor wins.
    expect(computeForecastDays(25, 16)).toBe(UV_MIN_FORECAST_DAYS)
  })

  it('returns the requested range in days once it meets the UV minimum', () => {
    expect(computeForecastDays(168, 16)).toBe(7)   // exactly 7d
    expect(computeForecastDays(240, 16)).toBe(10)  // 10d
    expect(computeForecastDays(336, 16)).toBe(14)  // 14d
  })

  it('caps at the provided max', () => {
    expect(computeForecastDays(1000, 16)).toBe(16)
  })

  it('handles zero/edge values without going below the UV minimum', () => {
    expect(computeForecastDays(0, 16)).toBe(UV_MIN_FORECAST_DAYS)
    expect(computeForecastDays(1, 16)).toBe(UV_MIN_FORECAST_DAYS)
  })
})

describe('fetchForecast with marine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeForecastResponse(hours: number) {
    const time: string[] = []
    const data: Record<string, (number | null)[]> = {}
    for (const m of MODELS) {
      data[`temperature_2m_${m.id}`] = Array(hours).fill(20)
      data[`wind_direction_10m_${m.id}`] = Array(hours).fill(180)
    }
    for (let i = 0; i < hours; i++) {
      time.push(new Date(2026, 0, 1, i).toISOString())
    }
    return { hourly: { time, ...data }, utc_offset_seconds: 0 }
  }

  it('does not call fetchMarine when includeMarine is false', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeForecastResponse(3),
    } as Response)

    await fetchForecast(0, 0, MODELS, METRICS, 1, undefined, false)
    expect(fetchMarine).not.toHaveBeenCalled()
  })

  it('calls fetchMarine and merges results when includeMarine is true', async () => {
    const fResponse = makeForecastResponse(3)
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fResponse,
    } as Response)
    const t0 = new Date(fResponse.hourly.time[0])
    vi.mocked(fetchMarine).mockResolvedValue({
      time: [t0, new Date(t0.getTime() + 3600000), new Date(t0.getTime() + 2 * 3600000)],
      timeStrings: fResponse.hourly.time.slice(0, 3),
      series: {
        marine_global: {
          wave_height: [0.5, 0.6, 0.7],
          wave_period: [6, 7, 8],
        },
      },
      utcOffsetSeconds: 0,
    })

    const result = await fetchForecast(0, 0, MODELS, METRICS, 1, undefined, true)
    expect(fetchMarine).toHaveBeenCalledTimes(1)
    expect(result.series.marine_global).toBeDefined()
    expect(result.series.marine_global.wave_height).toEqual([0.5, 0.6, 0.7])
    expect(result.series.marine_global.wave_period).toEqual([6, 7, 8])
  })

  it('pads marine data with nulls when it covers fewer hours than forecast', async () => {
    const fResponse = makeForecastResponse(5)
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fResponse,
    } as Response)
    const t0 = new Date(fResponse.hourly.time[0])
    vi.mocked(fetchMarine).mockResolvedValue({
      time: [t0, new Date(t0.getTime() + 3600000)],
      timeStrings: fResponse.hourly.time.slice(0, 2),
      series: { marine_global: { wave_height: [0.5, 0.6] } },
      utcOffsetSeconds: 0,
    })

    const result = await fetchForecast(0, 0, MODELS, METRICS, 1, undefined, true)
    expect(result.series.marine_global).toBeDefined()
    expect(result.series.marine_global.wave_height).toEqual([0.5, 0.6, null, null, null])
  })

  it('skips marine data when start timestamps do not align', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeForecastResponse(3),
    } as Response)
    vi.mocked(fetchMarine).mockResolvedValue({
      time: [new Date(2027, 0, 1, 0)],
      series: { marine_global: { wave_height: [0.5] } },
      utcOffsetSeconds: 0,
    })

    const result = await fetchForecast(0, 0, MODELS, METRICS, 1, undefined, true)
    expect(result.series.marine_global).toBeUndefined()
  })

  it('tolerates marine fetch failures and returns forecast without marine series', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeForecastResponse(3),
    } as Response)
    vi.mocked(fetchMarine).mockRejectedValue(new Error('network'))

    const result = await fetchForecast(0, 0, MODELS, METRICS, 1, undefined, true)
    expect(result.series.marine_global).toBeUndefined()
  })
})

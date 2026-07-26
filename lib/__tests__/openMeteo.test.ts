import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn(),
}))

vi.mock('@/lib/marine', () => ({
  fetchMarine: vi.fn(),
  computeMarineDays: vi.fn(() => 7),
}))

import { fetchForecast, UV_MIN_FORECAST_DAYS } from '../openMeteo'
import { fetchWithTimeout } from '../fetchWithTimeout'
import { fetchMarine } from '../marine'
import { METRICS, MODELS } from '../models'

describe('UV_MIN_FORECAST_DAYS', () => {
  it('is the floor we use to make sure short horizons still cover today\'s UV', () => {
    expect(UV_MIN_FORECAST_DAYS).toBe(7)
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
      timeStrings: ['2027-01-01T00:00'],
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

// B-NEW-3: the Open-Meteo /v1/forecast endpoint pads every per-model
// `hourly.*` series with `null` once the shortest requested model's
// horizon is reached, even if other models in the same request cover
// 384h. With the previous `regionSelected.slice(0, 10)` the first 7
// entries were always short-range regionals (maxHours 48–120), so the
// response was effectively null past hour 48 and the DailySummary /
// InsightsTable collapsed to ~2 days of valid data. We now filter
// long-range models (maxHours ≥ 336) to the front of the cap.
describe('fetchForecast model selection (B-NEW-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeShortTruncatedResponse(hours: number) {
    // Mimics the bug: hourly.time spans 384 entries but the per-model
    // series are null-padded past the shortest model.
    const time: string[] = []
    const data: Record<string, (number | null)[]> = {}
    for (const m of MODELS) {
      const arr = new Array<number | null>(hours).fill(20)
      data[`temperature_2m_${m.id}`] = arr
      data[`wind_direction_10m_${m.id}`] = new Array<number | null>(hours).fill(180)
    }
    for (let i = 0; i < hours; i++) {
      time.push(new Date(2026, 0, 1, i).toISOString())
    }
    return { hourly: { time, ...data }, utc_offset_seconds: 0 }
  }

  it('uses only long-range models in the API request (maxHours >= 336)', async () => {
    const captured: string[] = []
    vi.mocked(fetchWithTimeout).mockImplementation(async (url) => {
      // url is a relative path like "/api/forecast?...". Anchor it so
      // the URL constructor doesn't reject it in jsdom.
      const qs = new URL(url, 'http://localhost')
      captured.push(qs.searchParams.get('models') ?? '')
      return {
        ok: true,
        status: 200,
        json: async () => makeShortTruncatedResponse(384),
      } as Response
    })

    await fetchForecast(41.45, 2.25, MODELS, METRICS, 16, undefined, false)
    expect(captured).toHaveLength(1)
    const requested = (captured[0] ?? '').split(',').filter(Boolean)
    expect(requested.length).toBeGreaterThan(0)
    // Every requested model must cover at least 336h so the Open-Meteo
    // response carries non-null series for the full 14-day horizon.
    const longIds = new Set(
      MODELS.filter(m => m.maxHours >= 336).map(m => m.id)
    )
    for (const id of requested) {
      expect(longIds.has(id), `model ${id} (maxHours < 336) leaked into the request`).toBe(true)
    }
  })

  it('still surfaces the per-model series for the long-range models in the response', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeShortTruncatedResponse(384),
    } as Response)

    const result = await fetchForecast(41.45, 2.25, MODELS, METRICS, 16, undefined, false)
    // The series payload for the long-range models should be the full
    // 384h array the test stub returned, not a 48h truncated slice.
    const longIds = MODELS.filter(m => m.maxHours >= 336).map(m => m.id)
    expect(longIds.length).toBeGreaterThan(0)
    for (const id of longIds) {
      const arr = result.series[id]?.temperature
      expect(arr?.length, `series for ${id} should not be truncated`).toBe(384)
    }
  })
})

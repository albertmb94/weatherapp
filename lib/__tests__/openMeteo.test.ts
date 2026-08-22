import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn(),
}))

vi.mock('@/lib/marine', () => ({
  fetchMarine: vi.fn(),
  computeMarineDays: vi.fn(() => 7),
}))

import { fetchForecast, aggregateDailySeries, detectModelsWithNoData, UV_MIN_FORECAST_DAYS } from '../openMeteo'
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

// B-NEW-41 (2026-08-22): live verification against Open-Meteo showed
// that mixing short-range regional models with long-range globals does
// NOT truncate the response — each model returns a full-length array
// null-padded past its own horizon. The previous restriction to
// maxHours >= 336 silently removed every high-resolution regional
// model (AROME-FR HD, ICON-D2, ICON-EU, ARPEGE-EU...) from the
// ensemble, collapsing short-lead temperature/precipitation onto
// coarse globals. The request must again include the full regional +
// global + AI mix for the location.
describe('fetchForecast model selection (B-NEW-41)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeMixedResponse(hours: number) {
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

  it('requests regional high-res models together with globals and AI models', async () => {
    const captured: string[] = []
    vi.mocked(fetchWithTimeout).mockImplementation(async (url) => {
      const qs = new URL(url, 'http://localhost')
      captured.push(qs.searchParams.get('models') ?? '')
      return {
        ok: true,
        status: 200,
        json: async () => makeMixedResponse(384),
      } as Response
    })

    // Badalona → Europe: must include AROME-FR HD (1.3km regional),
    // ECMWF IFS (global) and AIFS (AI) in the SAME request.
    await fetchForecast(41.45, 2.25, MODELS, METRICS, 16, undefined, false)
    expect(captured).toHaveLength(1)
    const requested = new Set((captured[0] ?? '').split(',').filter(Boolean))
    expect(requested.has('meteofrance_arome_france_hd')).toBe(true)
    expect(requested.has('dwd_icon_d2')).toBe(true)
    expect(requested.has('meteofrance_arpege_europe')).toBe(true)
    expect(requested.has('icon_eu')).toBe(true)
    expect(requested.has('ecmwf_ifs')).toBe(true)
    expect(requested.has('gfs_global')).toBe(true)
    expect(requested.has('ecmwf_aifs025')).toBe(true)
  })

  it('fetches every land model selectable in Europe within the cap', async () => {
    const captured: string[] = []
    vi.mocked(fetchWithTimeout).mockImplementation(async (url) => {
      const qs = new URL(url, 'http://localhost')
      captured.push(qs.searchParams.get('models') ?? '')
      return {
        ok: true,
        status: 200,
        json: async () => makeMixedResponse(384),
      } as Response
    })

    await fetchForecast(41.45, 2.25, MODELS, METRICS, 16, undefined, false)
    const requested = new Set((captured[0] ?? '').split(',').filter(Boolean))
    // Every European + global + AI land model the selector can toggle
    // must have a real series behind it (no null-only columns).
    const europeanLand = MODELS.filter(
      m => m.id !== 'marine_global' &&
        (m.region === 'europe' || m.region === 'global')
    )
    expect(europeanLand.length).toBeGreaterThan(10)
    for (const m of europeanLand) {
      expect(requested.has(m.id), `${m.id} missing from the API request`).toBe(true)
    }
    // Other regions' models stay out of a European request.
    expect(requested.has('ncep_hrrr_conus')).toBe(false)
    expect(requested.has('jma_msm')).toBe(false)
  })

  it('still surfaces the per-model series for every requested model', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeMixedResponse(384),
    } as Response)

    const result = await fetchForecast(41.45, 2.25, MODELS, METRICS, 16, undefined, false)
    const arr = result.series['meteofrance_arome_france_hd']?.temperature
    expect(arr?.length, 'series for the regional model should not be truncated').toBe(384)
    const ecmwf = result.series['ecmwf_ifs']?.temperature
    expect(ecmwf?.length).toBe(384)
  })
})

describe('aggregateDailySeries (B-NEW-41)', () => {
  const models = [
    { id: 'a', weight: 30 },
    { id: 'b', weight: 10 },
    { id: 'c', weight: 0 },
  ] as unknown as Parameters<typeof aggregateDailySeries>[2]

  it('aggregates per-model suffixed keys with static weights', () => {
    const daily = {
      precipitation_sum_a: [1, 2],
      precipitation_sum_b: [3, 6],
    }
    // Row 0: (1*30 + 3*10)/40 = 1.5; row 1: (2*30 + 6*10)/40 = 3.
    expect(aggregateDailySeries(daily, 'precipitation_sum', models)).toEqual([1.5, 3])
  })

  it('tolerates ragged arrays: shorter models only contribute to their rows', () => {
    const daily = {
      precipitation_sum_a: [1, 2, 4],
      precipitation_sum_b: [3],
    }
    // Row 0: (1*30+3*10)/40 = 1.5; row 1: only model a → 2; row 2 → 4.
    expect(aggregateDailySeries(daily, 'precipitation_sum', models)).toEqual([1.5, 2, 4])
  })

  it('skips empty arrays entirely and falls back to the unsuffixed key', () => {
    const daily = {
      precipitation_sum_a: [],
      precipitation_sum_b: [],
      precipitation_sum: [7, 9],
    }
    expect(aggregateDailySeries(daily, 'precipitation_sum', models)).toEqual([7, 9])
  })

  it('returns [] when nothing usable exists', () => {
    expect(aggregateDailySeries({}, 'precipitation_sum', models)).toEqual([])
  })
})

describe('detectModelsWithNoData (B-NEW-41)', () => {
  it('flags models whose keys exist but contain only nulls', () => {
    const parsed = {
      hourly: {
        time: ['2026-08-22T00:00', '2026-08-22T01:00'],
        temperature_2m_ecmwf_ifs: [15, 16],
        temperature_2m_ecmwf_aifs025: [null, null],
        precipitation_ecmwf_aifs025: [null, null],
        // gfs_global has NO key at all in this fixture → out of
        // coverage footprint, not an empty payload.
        wind_speed_10m_ncep_aigfs025: [3, 4],
      },
    }
    const out = detectModelsWithNoData(parsed, ['ecmwf_ifs', 'ecmwf_aifs025', 'gfs_global'])
    expect(out).toEqual(['ecmwf_aifs025'])
  })

  it('does not flag models with at least one finite value anywhere', () => {
    const parsed = {
      hourly: {
        temperature_2m_ecmwf_aifs025: [null, 12],
      },
    }
    expect(detectModelsWithNoData(parsed, ['ecmwf_aifs025'])).toEqual([])
  })

  it('returns [] without hourly payload or requested ids', () => {
    expect(detectModelsWithNoData({}, ['a'])).toEqual([])
    expect(detectModelsWithNoData({ hourly: {} }, [])).toEqual([])
  })
})

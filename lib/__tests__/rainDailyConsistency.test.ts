import { describe, it, expect, vi } from 'vitest'
vi.mock('../fetchWithTimeout', () => ({ fetchWithTimeout: vi.fn() }))
import { fetchWithTimeout } from '../fetchWithTimeout'
import { fetchForecast } from '../openMeteo'
import { MODELS, METRICS } from '../models'
import { meanAtHour, weightsFor } from '../ensemble/central'
import { RAIN_ADJUSTMENT_SERIES } from '../ensemble/rainCalibration'
import { sumPrecipitationForDay } from '../ensemble/precipitationDay'

describe('local rain calibration agrees across hourly and daily views', () => {
  it('attributes midnight to the preceding day and keeps partial windows bounded', () => {
    const times = Array.from({ length: 26 }, (_, i) => new Date(Date.UTC(2026, 10, 9, i)))
    const rain = times.map((_, i) => i === 0 ? 40 : i === 24 ? 5 : 1)
    expect(sumPrecipitationForDay(times, 0, 23, i => rain[i])).toBe(28)
    expect(sumPrecipitationForDay(times, 5, 6, i => rain[i])).toBe(2)
    expect(sumPrecipitationForDay(times, 0, 23, () => null)).toBeNull()
  })

  it('derives daily totals from corrected hourly ensemble while preserving raw model values', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-08T00:00Z'))
    try {
      const time = Array.from({ length: 25 }, (_, i) => new Date(Date.UTC(2026, 10, 9, i)).toISOString().slice(0, 16))
      const rain = [20, ...Array(24).fill(1)]
      vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(JSON.stringify({
        utc_offset_seconds: 0,
        hourly: { time, precipitation_ecmwf_ifs: rain },
        daily: { time: ['2026-11-09'], precipitation_sum_ecmwf_ifs: [24], precipitation_hours_ecmwf_ifs: [24] },
      })))
      const result = await fetchForecast(41.45, 2.2475, MODELS, METRICS, 7)
      expect(result.series.ecmwf_ifs.precipitation).toEqual(rain)
      expect(result.series[RAIN_ADJUSTMENT_SERIES]).toBeDefined()
      const first = meanAtHour(result, 'precipitation', 1, MODELS, weightsFor('precipitation', 25, 1, MODELS))!
      expect(first).toBeLessThan(1)
      const last = meanAtHour(result, 'precipitation', 24, MODELS, weightsFor('precipitation', 48, 1, MODELS))!
      expect(result.dailyPrecipitationSum[0]).toBeCloseTo(first * 23 + last, 8)
    } finally { clock.mockRestore() }
  })
})

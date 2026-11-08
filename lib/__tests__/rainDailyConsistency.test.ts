import { describe, it, expect, vi } from 'vitest'
vi.mock('../fetchWithTimeout', () => ({ fetchWithTimeout: vi.fn() }))
import { fetchWithTimeout } from '../fetchWithTimeout'
import { fetchForecast } from '../openMeteo'
import { MODELS, METRICS } from '../models'
import { meanAtHour, weightsFor } from '../ensemble/central'
import { RAIN_ADJUSTMENT_SERIES } from '../ensemble/rainCalibration'

describe('local rain calibration agrees across hourly and daily views', () => {
  it('derives daily totals from corrected hourly ensemble while preserving raw model values', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-08T00:00Z'))
    try {
      const time = Array.from({ length: 24 }, (_, i) => `2026-11-09T${String(i).padStart(2, '0')}:00`)
      vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(JSON.stringify({
        utc_offset_seconds: 0,
        hourly: { time, precipitation_ecmwf_ifs: Array(24).fill(1) },
        daily: { time: ['2026-11-09'], precipitation_sum_ecmwf_ifs: [24], precipitation_hours_ecmwf_ifs: [24] },
      })))
      const result = await fetchForecast(41.45, 2.2475, MODELS, METRICS, 7)
      expect(result.series.ecmwf_ifs.precipitation).toEqual(Array(24).fill(1))
      expect(result.series[RAIN_ADJUSTMENT_SERIES]).toBeDefined()
      const first = meanAtHour(result, 'precipitation', 0, MODELS, weightsFor('precipitation', 24, 1, MODELS))!
      expect(first).toBeLessThan(1)
      expect(result.dailyPrecipitationSum[0]).toBeCloseTo(first * 24, 8)
    } finally { clock.mockRestore() }
  })
})

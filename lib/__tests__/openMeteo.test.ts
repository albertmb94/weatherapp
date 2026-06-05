import { describe, it, expect } from 'vitest'
import { computeForecastDays, UV_MIN_FORECAST_DAYS } from '../openMeteo'

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

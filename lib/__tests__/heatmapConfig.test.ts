import { describe, it, expect } from 'vitest'
import { HEATMAP_ROWS, HEATMAP_COLS, HEATMAP_MAX_LOCATIONS, HEATMAP_DEBOUNCE_MS, HEATMAP_FORECAST_DAYS } from '../heatmapConfig'

describe('heatmapConfig', () => {
  it('has valid HEATMAP_ROWS', () => {
    expect(HEATMAP_ROWS).toBeGreaterThan(0)
    expect(Number.isInteger(HEATMAP_ROWS)).toBe(true)
  })

  it('has valid HEATMAP_COLS', () => {
    expect(HEATMAP_COLS).toBeGreaterThan(0)
    expect(Number.isInteger(HEATMAP_COLS)).toBe(true)
  })

  it('HEATMAP_MAX_LOCATIONS is reasonable', () => {
    expect(HEATMAP_MAX_LOCATIONS).toBeGreaterThanOrEqual(1)
    expect(HEATMAP_MAX_LOCATIONS).toBeLessThanOrEqual(1000)
  })

  it('HEATMAP_DEBOUNCE_MS is positive', () => {
    expect(HEATMAP_DEBOUNCE_MS).toBeGreaterThan(0)
  })

  it('HEATMAP_FORECAST_DAYS is positive', () => {
    expect(HEATMAP_FORECAST_DAYS).toBeGreaterThan(0)
  })
})

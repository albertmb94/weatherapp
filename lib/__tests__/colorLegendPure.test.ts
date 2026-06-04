import { describe, it, expect } from 'vitest'
import { SCALES, type ScaleMetric } from '@/lib/colorScales'

function buildGradientStops(metric: ScaleMetric): string {
  const stops = SCALES[metric]
  const maxVal = stops[stops.length - 1].value
  const minVal = stops[0].value
  const range = maxVal - minVal || 1
  return stops
    .map(s => {
      const pct = ((s.value - minVal) / range) * 100
      const [r, g, b] = s.color
      return `rgb(${r},${g},${b}) ${pct.toFixed(1)}%`
    })
    .join(', ')
}

describe('buildGradientStops', () => {
  it('returns a valid CSS gradient string for temperature', () => {
    const result = buildGradientStops('temperature')
    expect(result).toContain('rgb(')
    expect(result).toContain('%')
    expect(result.split(',').length).toBeGreaterThanOrEqual(2)
  })

  it('starts at 0% and ends at 100%', () => {
    const result = buildGradientStops('temperature')
    expect(result).toMatch(/0\.0%/)
    expect(result).toMatch(/100\.0%/)
  })

  it('works for all scale metrics', () => {
    const metrics = Object.keys(SCALES) as ScaleMetric[]
    for (const metric of metrics) {
      const result = buildGradientStops(metric)
      expect(result).toBeTruthy()
      expect(result).toContain('rgb(')
    }
  })
})

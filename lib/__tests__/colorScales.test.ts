import { describe, it, expect } from 'vitest'
import { getColor, SCALES } from '../colorScales'

describe('getColor', () => {
  it('returns dark gray for null', () => {
    expect(getColor('temperature', null)).toBe('#2a2a2a')
  })

  it('returns dark gray for undefined', () => {
    expect(getColor('temperature', undefined as unknown as number)).toBe('#2a2a2a')
  })

  it('returns color at minimum scale value', () => {
    const stops = SCALES.temperature
    const color = getColor('temperature', stops[0].value)
    expect(color).toContain('rgb(')
  })

  it('returns color at maximum scale value', () => {
    const stops = SCALES.temperature
    const color = getColor('temperature', stops[stops.length - 1].value)
    expect(color).toContain('rgb(')
  })

  it('interpolates between stops', () => {
    const color = getColor('temperature', 7.5)
    expect(color).toContain('rgb(')
  })

  it('clamps below minimum', () => {
    const stops = SCALES.temperature
    const color = getColor('temperature', stops[0].value - 100)
    expect(color).toContain('rgb(')
  })

  it('clamps above maximum', () => {
    const stops = SCALES.temperature
    const color = getColor('temperature', stops[stops.length - 1].value + 100)
    expect(color).toContain('rgb(')
  })

  it('handles all metric types', () => {
    const metrics = Object.keys(SCALES) as Array<keyof typeof SCALES>
    for (const metric of metrics) {
      const stops = SCALES[metric]
      const mid = (stops[0].value + stops[stops.length - 1].value) / 2
      const color = getColor(metric, mid)
      expect(color).toContain('rgb(')
    }
  })

  it('uses temperature scale for "all" metric', () => {
    const colorAll = getColor('all', 20)
    const colorTemp = getColor('temperature', 20)
    expect(colorAll).toBe(colorTemp)
  })
})

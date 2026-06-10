import { describe, it, expect } from 'vitest'
import { haversineKm, withDistance } from '../geoDistance'

describe('haversineKm', () => {
  it('same point = 0', () => {
    expect(haversineKm([41.4, 2.15], [41.4, 2.15])).toBeCloseTo(0, 3)
  })

  it('Barcelona ↔ Madrid ≈ 505 km', () => {
    const d = haversineKm([41.4, 2.15], [40.42, -3.70])
    expect(d).toBeGreaterThan(490)
    expect(d).toBeLessThan(520)
  })

  it('antipodal points ≈ 20015 km (half Earth circumference)', () => {
    const d = haversineKm([0, 0], [0, 180])
    expect(d).toBeGreaterThan(20000)
    expect(d).toBeLessThan(20030)
  })

  it('short distance within the same city is tiny', () => {
    const d = haversineKm([41.385, 2.173], [41.390, 2.180])
    expect(d).toBeLessThan(1)
  })
})

describe('withDistance', () => {
  it('annotates each station with a distanceKm number', () => {
    const stations = [
      { code: 'A', name: 'A', lat: 41.4, lon: 2.15 },
      { code: 'B', name: 'B', lat: 41.5, lon: 2.20 },
    ]
    const result = withDistance(stations, [41.4, 2.15])
    expect(result[0].code).toBe('A')
    expect(result[0].distanceKm).toBeCloseTo(0, 3)
    expect(result[1].code).toBe('B')
    expect(result[1].distanceKm).toBeGreaterThan(10)
    expect(result[1].distanceKm).toBeLessThan(15)
  })

  it('does not mutate the original array', () => {
    const stations = [{ code: 'A', name: 'A', lat: 41.4, lon: 2.15 }]
    const before = JSON.stringify(stations)
    withDistance(stations, [41.4, 2.15])
    expect(JSON.stringify(stations)).toBe(before)
  })
})

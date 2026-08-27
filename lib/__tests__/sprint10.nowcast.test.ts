/**
 * Regression tests for S10 nowcasting (`lib/nowcast.ts`).
 *
 * Pins three behaviours:
 *  - blendeo suave entre lectura de la estación y la ensemble
 *  - degradación cuando la observación es muy vieja (stale)
 *  - fallback a la ensemble cuando no hay estación cercana
 */

import { describe, expect, it } from 'vitest'
import { blendNowcast, pickClosestStation, type StationObservation } from '../nowcast'

const NOW = Date.UTC(2026, 6, 1, 12, 0, 0)

function obsAt(overrides: Partial<StationObservation> = {}): StationObservation {
  return {
    id: 'TEST',
    source: 'aemet',
    lat: 41.39,
    lon: 2.17,
    distanceKm: 0,
    observedAt: NOW - 5 * 60 * 1000,
    temperatureC: 22,
    humidityPct: 60,
    pressureHpa: 1015,
    windKmh: 10,
    windDirDeg: 180,
    precipitationMm: 0,
    ...overrides,
  }
}

describe('blendNowcast', () => {
  it('returns the ensemble when no station is available', () => {
    const r = blendNowcast({
      userLat: 41.39,
      userLon: 2.17,
      hourlyTemperatureC: [20],
      hourlyPrecipitationMm: [0],
      nowIndex: 0,
      station: null,
    })
    expect(r.temperatureC).toBe(20)
    expect(r.freshness).toBe('unavailable')
    expect(r.observationDeltaC).toBeNull()
  })

  it('blends fresh station + ensemble by 0.6/0.4 when both exist', () => {
    const r = blendNowcast({
      userLat: 41.39,
      userLon: 2.17,
      hourlyTemperatureC: [20],      // ensemble
      hourlyPrecipitationMm: [0],
      nowIndex: 0,
      station: obsAt({ temperatureC: 22, observedAt: NOW - 5 * 60 * 1000 }),
      nowMs: NOW,
    })
    // 0.6 * 22 + 0.4 * 20 = 13.2 + 8 = 21.2
    expect(r.temperatureC).toBeCloseTo(21.2, 5)
    expect(r.observationDeltaC).toBe(2)
    expect(r.freshness).toBe('fresh')
  })

  it('treats a >90-min-old observation as stale and falls back to the ensemble', () => {
    const r = blendNowcast({
      userLat: 41.39,
      userLon: 2.17,
      hourlyTemperatureC: [20],
      hourlyPrecipitationMm: [0],
      nowIndex: 0,
      station: obsAt({ temperatureC: 24, observedAt: NOW - 6 * 60 * 60 * 1000 }),
      nowMs: NOW,
    })
    expect(r.freshness).toBe('stale')
    expect(r.temperatureC).toBe(20)
    expect(r.observationDeltaC).toBe(4)
  })

  it('uses the observation alone when the ensemble is null', () => {
    const r = blendNowcast({
      userLat: 41.39,
      userLon: 2.17,
      hourlyTemperatureC: [null],
      hourlyPrecipitationMm: [null],
      nowIndex: 0,
      station: obsAt({ temperatureC: 18, observedAt: NOW - 5 * 60 * 1000 }),
      nowMs: NOW,
    })
    expect(r.temperatureC).toBe(18)
  })

  // BUG FIX regression: the previous build hard-coded `obsPrecip`
  // to `null` and the nowcast's rain cell always equalled the
  // ensemble. We now blend with a small (0.3) observation weight
  // so a 5-km-away AEMET station showing 4 mm/h pulls the
  // ensemble visibly.
  it('blends precipitation when the station reports it', () => {
    const r = blendNowcast({
      userLat: 41.39,
      userLon: 2.17,
      hourlyTemperatureC: [22],
      hourlyPrecipitationMm: [0],
      nowIndex: 0,
      station: obsAt({ temperatureC: 22, precipitationMm: 4, observedAt: NOW - 5 * 60 * 1000 }),
      nowMs: NOW,
    })
    // 0.3 * 4 + 0.7 * 0 = 1.2
    expect(r.precipitationMm).toBeCloseTo(1.2, 5)
  })

  it('uses the observation precipitation alone when the ensemble has none', () => {
    const r = blendNowcast({
      userLat: 41.39,
      userLon: 2.17,
      hourlyTemperatureC: [22],
      hourlyPrecipitationMm: [null],
      nowIndex: 0,
      station: obsAt({ temperatureC: 22, precipitationMm: 1.5, observedAt: NOW - 5 * 60 * 1000 }),
      nowMs: NOW,
    })
    expect(r.precipitationMm).toBe(1.5)
  })
})

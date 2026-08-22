/**
 * Regression tests for S1/Sprint 1:
 *  - `precipitation_probability` is now a first-class MetricId/METRIC.
 *  - `friendlyForecast.computeCurrentSnapshot` consumes it from the
 *    raw series (rather than the historical intensity heuristic).
 *  - `weightsForAbsolute` uses the absolute hour index so a slice
 *    that starts at hour 86 ("opened mid-afternoon") no longer
 *    misclassifies rows as 0-48h.
 */

import { describe, expect, it } from 'vitest'
import {
  METRICS,
  type MetricId,
  type WeatherModel,
} from '@/lib/models'
import {
  resolveActiveModels,
  weightsForAbsolute,
  weightsFor,
} from '@/lib/ensemble/central'
import { computeCurrentSnapshot, type SeriesBag } from '@/lib/friendlyForecast'

const MODELS: WeatherModel[] = [
  { id: 'ecmwf_ifs', label: 'ECMWF', color: '#000', maxHours: 240, weight: 30, type: 'deterministic', region: 'global', resolution: 9 },
  { id: 'meteofrance_arome_france_hd', label: 'AROME-HD', color: '#f00', maxHours: 48, weight: 20, type: 'deterministic', region: 'europe', resolution: 1 },
]

function makeBag(probByModel: (number | null)[][]): SeriesBag {
  const hours = probByModel[0]?.length ?? 0
  const series: Record<string, Record<string, (number | null)[]>> = {}
  const ids = ['ecmwf_ifs', 'meteofrance_arome_france_hd']
  ids.forEach((id, i) => {
    series[id] = {
      temperature: Array.from({ length: hours }, () => 15 + i),
      wind_speed: Array.from({ length: hours }, () => 10),
      wind_gusts: Array.from({ length: hours }, () => 15),
      precipitation: Array.from({ length: hours }, () => 0),
      precipitation_probability: probByModel[i]?.map(v => v) ?? [],
      cloud_cover: Array.from({ length: hours }, () => 40),
      humidity: Array.from({ length: hours }, () => 70),
      uv_index: Array.from({ length: hours }, () => 0),
    }
  })
  return {
    time: Array.from({ length: hours }, (_, i) => new Date(Date.UTC(2026, 6, 26, i, 0, 0))),
    series,
  }
}

describe('precipitation_probability', () => {
  it('is registered as a MetricId and METRIC', () => {
    const ids: MetricId[] = METRICS.map(m => m.id)
    expect(ids).toContain('precipitation_probability')
    const m = METRICS.find(x => x.id === 'precipitation_probability')
    expect(m).toBeDefined()
    expect(m?.hourlyParam).toBe('precipitation_probability')
    expect(m?.group).toBe('land')
  })

  it('computeCurrentSnapshot picks the calibrated probability series over the intensity heuristic', () => {
    const bag = makeBag([
      [10, 20, 30],
      [40, 50, 60],
    ])
    const snapshot = computeCurrentSnapshot(
      bag,
      MODELS,
      // Active ids intentionally not relevant: WedAI mode is forced.
      ['ecmwf_ifs'],
      1,
    )
    // Mean of [20, 50] = 35.
    expect(snapshot?.chanceOfRainPct).toBe(35)
  })

  it('falls back to the intensity heuristic when no model has a probability', () => {
    const bag = makeBag([
      [null, null, null],
      [null, null, null],
    ])
    // Make `precipitation` non-zero in the same hour so the heuristic
    // returns a non-null number (1 mm/h × 80 = 80).
    for (const id of Object.keys(bag.series)) {
      bag.series[id].precipitation = [0, 1, 1]
    }
    const snapshot = computeCurrentSnapshot(bag, MODELS, ['ecmwf_ifs'], 1)
    expect(snapshot?.chanceOfRainPct).toBe(80)
  })
})

describe('weightsForAbsolute', () => {
  it('classifies row 0 of a bucket=1 starting at hourIndex=86 as 96-168h, not 0-48h', () => {
    const active = resolveActiveModels(MODELS, [], 'wedai')
    const weights = weightsForAbsolute('temperature', 86, 1, active)
    // The 96-168h preset is the only one that contains ECMWF IFS at 0.40
    // and an AROME entry of 0.0 (no weight). The 0-48h preset would put
    // AROME at 0.02 — verifying absolute semantics does not.
    const aromeIdx = active.findIndex(m => m.id === 'meteofrance_arome_france_hd')
    const ecmwfIdx = active.findIndex(m => m.id === 'ecmwf_ifs')
    expect(weights[aromeIdx]).toBeCloseTo(0.01)
    // ECMWF must be at the heaviest preset for this bucket.
    expect(weights[ecmwfIdx]).toBeGreaterThan(weights[aromeIdx])
  })

  it('weightsFor used with hourIndex=0 still gives the 0-48h preset', () => {
    const active = resolveActiveModels(MODELS, [], 'wedai')
    const weights = weightsFor('temperature', 0, 1, active)
    const aromeIdx = active.findIndex(m => m.id === 'meteofrance_arome_france_hd')
    // B-NBT-8: calibrated bucket (AROME-FR HD normalised win-rate
    // 0.064 in temperature 0-48h) rescaled by the AI share of 0.20.
    expect(weights[aromeIdx]).toBeCloseTo(0.064 * 0.8)
  })
})

describe('lead time buckets beyond 168h', () => {
  it('assigns 200h to the new 168-240h bucket', async () => {
    const { getLeadTimeBucket } = await import('@/lib/models')
    expect(getLeadTimeBucket(200)).toBe('168-240h')
    expect(getLeadTimeBucket(300)).toBe('240-360h')
  })
})

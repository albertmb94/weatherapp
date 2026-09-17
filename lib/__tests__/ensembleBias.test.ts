import { describe, it, expect } from 'vitest'
import {
  biasForMetricBucket,
  meanAtHour,
  ensembleWithFallback,
  resolveActiveModels,
  type BiasTable,
  type SeriesBag,
} from '@/lib/ensemble/central'
import { MODELS } from '@/lib/models'

const TABLE: BiasTable = {
  temperature: {
    '0-48h': { ecmwf_ifs: 2, icon_global: -1 },
    '96-168h': { ecmwf_ifs: 0.5 },
  },
}

describe('biasForMetricBucket', () => {
  it('resolves the bucket from the lead time', () => {
    expect(biasForMetricBucket(TABLE, 'temperature', 0)).toEqual({
      ecmwf_ifs: 2,
      icon_global: -1,
    })
    expect(biasForMetricBucket(TABLE, 'temperature', 120)).toEqual({ ecmwf_ifs: 0.5 })
  })

  it('falls back to 0-48h when the higher bucket is unmeasured', () => {
    expect(biasForMetricBucket(TABLE, 'temperature', 200)).toEqual({
      ecmwf_ifs: 2,
      icon_global: -1,
    })
  })

  it('returns undefined when the metric or the whole table is missing', () => {
    expect(biasForMetricBucket(TABLE, 'wind_speed', 0)).toBeUndefined()
    expect(biasForMetricBucket(null, 'temperature', 0)).toBeUndefined()
    expect(biasForMetricBucket(undefined, 'temperature', 0)).toBeUndefined()
  })

  it('is evidence-gated: metrics the holdout did not clear are never corrected', () => {
    // The evaluator measured bias correction HURTS wind (+2.1 % RMSE), so
    // even a populated wind table must be ignored.
    const windTable: BiasTable = { wind_speed: { '0-48h': { ecmwf_ifs: 2 } } }
    expect(biasForMetricBucket(windTable, 'wind_speed', 0)).toBeUndefined()
    // temperature is on the whitelist, so it still resolves.
    expect(biasForMetricBucket(TABLE, 'temperature', 0)).toEqual({
      ecmwf_ifs: 2,
      icon_global: -1,
    })
  })
})

describe('meanAtHour bias correction', () => {
  const bag: SeriesBag = {
    time: [new Date(Date.UTC(2026, 7, 15, 0))],
    series: {
      ecmwf_ifs: { temperature: [10] },
      icon_global: { temperature: [20] },
    },
  }
  const active = resolveActiveModels(MODELS, [], 'wedai').filter(
    m => m.id === 'ecmwf_ifs' || m.id === 'icon_global'
  )
  const weights = [1, 1] // equal, so the arithmetic is easy to read

  it('subtracts each model bias before averaging', () => {
    // (10 - 2) + (20 - (-1)) = 8 + 21 = 29 → /2 = 14.5
    expect(meanAtHour(bag, 'temperature', 0, active, weights, { ecmwf_ifs: 2, icon_global: -1 })).toBeCloseTo(14.5, 6)
  })

  it('is a no-op without a bias map (degrades to today behaviour)', () => {
    expect(meanAtHour(bag, 'temperature', 0, active, weights)).toBeCloseTo(15, 6)
    expect(meanAtHour(bag, 'temperature', 0, active, weights, null)).toBeCloseTo(15, 6)
  })

  it('skips models with no measured bias', () => {
    // Only ecmwf is de-biased: (10-2) + 20 = 28 → /2 = 14
    expect(meanAtHour(bag, 'temperature', 0, active, weights, { ecmwf_ifs: 2 })).toBeCloseTo(14, 6)
  })

  it('applies the same correction through ensembleWithFallback', () => {
    const v = ensembleWithFallback(
      bag.series,
      'temperature',
      0,
      active,
      active,
      weights,
      0,
      { ecmwf_ifs: 2, icon_global: -1 },
    )
    expect(v).toBeCloseTo(14.5, 6)
  })
})

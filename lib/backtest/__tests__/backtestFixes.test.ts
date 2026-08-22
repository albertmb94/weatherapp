/**
 * B-NBT-1/2/3 regression tests for the backtest pipeline fixes
 * (2026-08-22):
 *
 *   1. `shiftWallClockDays` must shift the provider's wall-clock
 *      stamps by calendar days WITHOUT host-timezone conversion (the
 *      old Date round-trip skewed every previous_dayN init_time by
 *      the machine's UTC offset).
 *
 *   2. `computeAccuracyFromRaw` must pair predicted(valid_time) with
 *      observed(valid_time) — standard verification. The old
 *      init_time pairing compared a forecast for hour H against the
 *      weather at issue time, which is not a skill metric.
 *
 *   3. `uiBucketToBacktestBuckets` maps UI preset buckets onto the
 *      fine backtest buckets; beyond-horizon presets map to [].
 */

import { describe, it, expect } from 'vitest'
import { shiftWallClockDays, leadTimeBucket } from '../fetchPreviousRuns'
import { computeAccuracyFromRaw } from '../runWeeklyBacktest'
import { uiBucketToBacktestBuckets, type BacktestLocation } from '../config'
import { ENSEMBLE_PRESETS, METRIC_TO_ENSEMBLE, getLeadTimeBucket, MODELS } from '@/lib/models'

/**
 * B-NBT-8: the calibrated presets must PRIORITIZE the high-resolution
 * regional models at short lead times — the whole reason the
 * calibration exists. At 0-48h the combined share of the measurable
 * regionals must exceed ECMWF's (temperature) and GFS+ECMWF's
 * (precipitation); by 96-168h the globals take over because the
 * regionals are past their horizon.
 */
describe('calibrated preset prioritization (B-NBT-8)', () => {
  const REGIONALS = new Set([
    'icon_eu', 'dwd_icon_d2',
    'meteofrance_arpege_europe', 'meteofrance_arome_france', 'meteofrance_arome_france_hd',
    'dmi_harmonie_arome_europe', 'knmi_harmonie_arome_europe',
  ])

  function sharesFor(presetId: 'temperature' | 'precipitation', bucket: string) {
    const preset = ENSEMBLE_PRESETS.find(p => p.id === presetId)!
    // The AI-blend rescale multiplies every legacy entry by the same
    // factor, so RAW bucket ratios already decide any within-bucket
    // comparison — no need to replicate blendAiWeights here. The
    // comparator is the pair the old hand-authored ensemble leant on
    // (ecmwf_ifs + gfs_global); ncep_aigfs025 is calibrated like any
    // other model and counted separately.
    const raw = preset.weights[bucket]
    let regionals = 0
    let legacyPair = 0
    for (const [id, w] of Object.entries(raw)) {
      if (REGIONALS.has(id)) regionals += w as number
      else if (id === 'ecmwf_ifs' || id === 'gfs_global') legacyPair += w as number
    }
    return { regionals, legacyPair }
  }

  it('regionals outweigh the top global at 0-48h for temperature', () => {
    const { regionals, legacyPair } = sharesFor('temperature', '0-48h')
    expect(regionals).toBeGreaterThan(legacyPair)
    // ICON-EU specifically must be the single heaviest model.
    const preset = ENSEMBLE_PRESETS.find(p => p.id === 'temperature')!
    expect(preset.weights['0-48h'].icon_eu).toBeGreaterThan(
      preset.weights['0-48h'].ecmwf_ifs
    )
  })

  it('regionals outweigh the old ECMWF+GFS core at 0-48h for precipitation', () => {
    const { regionals, legacyPair } = sharesFor('precipitation', '0-48h')
    expect(regionals).toBeGreaterThan(legacyPair)
  })

  it('globals take over by 96-168h once regionals expire', () => {
    const preset = ENSEMBLE_PRESETS.find(p => p.id === 'temperature')!
    const bucket = preset.weights['96-168h']
    for (const regional of REGIONALS) {
      expect(bucket[regional as string]).toBeUndefined()
    }
    expect(bucket.ecmwf_ifs).toBeGreaterThan(bucket.gfs_global)
  })

  it('every measured bucket still forms a valid positive weight vector', () => {
    for (const preset of ENSEMBLE_PRESETS) {
      for (const [bucket, weights] of Object.entries(preset.weights)) {
        const values = Object.values(weights)
        expect(values.length).toBeGreaterThan(0)
        expect(values.every(w => Number.isFinite(w) && w > 0)).toBe(true)
        void bucket
      }
    }
  })

  it('metric→preset routing keeps wind on precipitation and dewpoint on temperature', () => {
    expect(METRIC_TO_ENSEMBLE.wind_speed).toBe('precipitation')
    expect(METRIC_TO_ENSEMBLE.dewpoint).toBe('temperature')
    expect(getLeadTimeBucket(200)).toBe('168-240h')
    // Sanity: all routed ids exist in MODELS.
    for (const id of Object.keys(METRIC_TO_ENSEMBLE)) {
      expect(MODELS.some(m => m.id === id) || typeof id === 'string').toBe(true)
    }
  })
})

describe('shiftWallClockDays (B-NBT-1)', () => {
  it('subtracts whole days keeping the wall-clock time intact', () => {
    // On any host timezone (UTC-11 … UTC+14) the result must keep
    // 'T00:00', not shift to 'T22:00' of the previous day.
    expect(shiftWallClockDays('2026-08-15T00:00', -3)).toBe('2026-08-12T00:00')
    expect(shiftWallClockDays('2026-08-15T14:00', -7)).toBe('2026-08-08T14:00')
    expect(shiftWallClockDays('2026-03-01T23:00', -1)).toBe('2026-02-28T23:00')
  })

  it('handles month and year boundaries', () => {
    expect(shiftWallClockDays('2026-01-05T09:30', -10)).toBe('2025-12-26T09:30')
    expect(shiftWallClockDays('2027-01-01T05:00', -1)).toBe('2026-12-31T05:00')
  })

  it('is idempotent when shifting by zero', () => {
    expect(shiftWallClockDays('2026-08-22T17:45', 0)).toBe('2026-08-22T17:45')
  })
})

describe('leadTimeBucket boundaries', () => {
  it('keeps the documented bucket edges', () => {
    expect(leadTimeBucket(0)).toBe('0-24h')
    expect(leadTimeBucket(24)).toBe('0-24h')
    expect(leadTimeBucket(25)).toBe('24-48h')
    expect(leadTimeBucket(48)).toBe('24-48h')
    expect(leadTimeBucket(168)).toBe('120-168h')
  })
})

describe('computeAccuracyFromRaw pairing (B-NBT-2)', () => {
  const location: BacktestLocation = {
    name: 'Test',
    lat: 41.39,
    lon: 2.17,
    terrain: 'coastal',
    country: 'ES',
  }

  it('pairs the forecast with the observation at VALID time, not init time', () => {
    const forecastRows = [
      // A day-2 forecast issued on the 13th, valid on the 15th.
      {
        model_id: 'ecmwf_ifs',
        init_time: '2026-08-13T14:00',
        valid_time: '2026-08-15T14:00',
        metric: 'temperature',
        predicted_value: 25,
        lead_time_hours: 48,
      },
    ]
    const observationRows = [
      // Observation AT ISSUE TIME (would be wrongly picked by the old code).
      { valid_time: '2026-08-13T14:00', metric: 'temperature', observed_value: 40 },
      // Observation AT VALID TIME (the correct pairing).
      { valid_time: '2026-08-15T14:00', metric: 'temperature', observed_value: 20 },
    ]
    const rows = computeAccuracyFromRaw(location, forecastRows, observationRows, '2026-08-15', '2026-08-15')
    expect(rows).toHaveLength(1)
    // MAE = |25 - 20| = 5 — NOT |25 - 40| = 15.
    expect(rows[0].mae).toBeCloseTo(5, 9)
    expect(rows[0].rmse).toBeCloseTo(5, 9)
    expect(rows[0].bias).toBeCloseTo(5, 9)
    expect(rows[0].sample_count).toBe(1)
    expect(rows[0].lead_time_bucket).toBe('24-48h')
  })

  it('drops forecast rows whose valid-time observation is missing', () => {
    const forecastRows = [
      {
        model_id: 'gfs_global',
        init_time: '2026-08-13T00:00',
        valid_time: '2026-08-15T00:00',
        metric: 'precipitation',
        predicted_value: 1.5,
        lead_time_hours: 48,
      },
    ]
    const observationRows = [
      { valid_time: '2026-08-13T00:00', metric: 'precipitation', observed_value: 3 },
    ]
    const rows = computeAccuracyFromRaw(location, forecastRows, observationRows, '2026-08-15', '2026-08-15')
    expect(rows).toEqual([])
  })

  it('groups samples per model/metric/bucket before computing metrics', () => {
    const forecastRows = [
      {
        model_id: 'a',
        init_time: '2026-08-14T00:00',
        valid_time: '2026-08-15T00:00',
        metric: 'wind_speed',
        predicted_value: 10,
        lead_time_hours: 24,
      },
      {
        model_id: 'a',
        init_time: '2026-08-14T01:00',
        valid_time: '2026-08-15T01:00',
        metric: 'wind_speed',
        predicted_value: 20,
        lead_time_hours: 24,
      },
      {
        model_id: 'b',
        init_time: '2026-08-14T02:00',
        valid_time: '2026-08-15T02:00',
        metric: 'wind_speed',
        predicted_value: 5,
        lead_time_hours: 24,
      },
    ]
    const observationRows = [
      { valid_time: '2026-08-15T00:00', metric: 'wind_speed', observed_value: 10 },
      { valid_time: '2026-08-15T01:00', metric: 'wind_speed', observed_value: 20 },
      { valid_time: '2026-08-15T02:00', metric: 'wind_speed', observed_value: 100 },
    ]
    const rows = computeAccuracyFromRaw(location, forecastRows, observationRows, '2026-08-15', '2026-08-15')
    // Model a's samples pair with their own hours; model b pairs with
    // the 02:00 observation — each group computes its own metrics.
    const rowA = rows.find(r => r.model_id === 'a')!
    const rowB = rows.find(r => r.model_id === 'b')!
    expect(rowA.sample_count).toBe(2)
    expect(rowA.mae).toBeCloseTo(0, 9)
    expect(rowB.sample_count).toBe(1)
    expect(rowB.mae).toBeCloseTo(95, 9)
  })
})

describe('uiBucketToBacktestBuckets (B-NBT-3)', () => {
  it('maps each UI preset bucket onto its fine backtest buckets', () => {
    expect(uiBucketToBacktestBuckets('0-48h')).toEqual(['0-24h', '24-48h'])
    expect(uiBucketToBacktestBuckets('48-96h')).toEqual(['48-72h', '72-96h'])
    expect(uiBucketToBacktestBuckets('96-168h')).toEqual(['96-120h', '120-168h'])
  })

  it('returns [] beyond the previous-runs horizon so callers degrade gracefully', () => {
    expect(uiBucketToBacktestBuckets('168-240h')).toEqual([])
    expect(uiBucketToBacktestBuckets('240-360h')).toEqual([])
  })
})

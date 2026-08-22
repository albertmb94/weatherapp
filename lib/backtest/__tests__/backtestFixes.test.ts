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

/**
 * Regression tests for S3 (dead-export removal + contract fixes):
 *  - `getMetricWeights` now returns the blended preset/dynamic
 *    weight map (was previously returning `{}`).
 *  - `weightedAvg` accepts an additive `biasCorrection` map so we can
 *    de-bias each model before averaging.
 *  - `buildForecastCacheKey` keeps `v` in its key (it's a cache-buster)
 *    while `buildUpstreamParams` strips it from the upstream URL.
 *  - `parseOpenMeteoTimes` parses non-standard ISO offsets.
 */

import { describe, expect, it } from 'vitest'
import { getMetricWeights, computeDynamicWeights } from '@/lib/backtest/computeDynamicWeights'
import { weightedAvg } from '@/lib/ensemble'
import {
  buildForecastCacheKey,
  buildUpstreamParams,
} from '@/lib/cacheKey'
import { parseOpenMeteoTime } from '@/lib/dateUtils'
import type { ModelAccuracyRow } from '@/lib/backtest/db'

function makeRow(overrides: Partial<ModelAccuracyRow> = {}): ModelAccuracyRow {
  return {
    model_id: 'ecmwf_ifs',
    lat: 0,
    lon: 0,
    terrain_type: 'plain',
    metric: 'temperature',
    lead_time_bucket: '0-48h',
    mae: 1,
    rmse: 1.5,
    bias: 0,
    sample_count: 100,
    window_start: '2026-07-19',
    window_end: '2026-07-26',
    computed_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('getMetricWeights', () => {
  it('returns the temperature preset when no accuracy records exist', () => {
    const w = getMetricWeights('temperature', [], 0.95, '0-48h')
    // B-NEW-41: the 0-48h bucket reserves a 0.20 share for the AI
    // models, so the legacy entries are rescaled by (1 - 0.2):
    // ecmwf_ifs 0.30 → 0.24, gfs_global 0.08 → 0.064.
    expect(w.ecmwf_ifs).toBeCloseTo(0.24, 5)
    expect(w.gfs_global).toBeCloseTo(0.064, 5)
    // The AI entries must be present with their proportional share
    // of the 0.20 AI budget: AIFS carries 22/44 of it → 0.10.
    expect(w.ecmwf_aifs025).toBeCloseTo(0.1, 5)
    const sum = Object.values(w).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 5)
  })

  it('blends the dynamic weights in when records exist', () => {
    const rows: ModelAccuracyRow[] = [
      makeRow({ model_id: 'ecmwf_ifs', rmse: 0.5 }),
      makeRow({ model_id: 'gfs_global', rmse: 3.0 }),
    ]
    const w = getMetricWeights('temperature', rows, 0.95, '0-48h')
    // After normalization the inverse-RMSE dominates, but the
    // 70/30 blend caps the swing so we don't get a degenerate
    // single-model ensemble.
    expect(w.ecmwf_ifs).toBeGreaterThan(w.gfs_global)
    expect(w.ecmwf_ifs).toBeLessThan(0.7)
    const sum = Object.values(w).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 3)
  })
})

describe('computeDynamicWeights', () => {
  it('is no longer the public API surface — covered by getMetricWeights', () => {
    expect(typeof computeDynamicWeights).toBe('function')
  })
})

describe('weightedAvg bias correction (S3/S10 groundwork)', () => {
  it('subtracts the per-model bias before averaging', () => {
    const values = [10, 20]
    const weights = [1, 1]
    const modelIds = ['a', 'b']
    // Bias of +5 on `a` shifts its contribution from 10 → 5.
    const bias = { a: 5, b: 0 }
    expect(weightedAvg(values, weights, null, modelIds, bias)).toBe(12.5)
  })

  it('keeps the model value unchanged when a bias is missing', () => {
    // Only `a` has a bias; `b` is left as-is.
    expect(weightedAvg([10, 20], [1, 1], null, ['a', 'b'], { a: 5 })).toBe(12.5)
  })

  it('is a no-op when biasCorrection is omitted', () => {
    expect(weightedAvg([10, 20], [1, 1], null, ['a', 'b'])).toBe(15)
  })
})

describe('Cache key / upstream separation', () => {
  it('cache key keeps `v`, upstream strips it', () => {
    const params = new URLSearchParams({ latitude: '41.39', longitude: '2.17', v: '1' })
    expect(buildForecastCacheKey(params)).toContain('v=1')
    expect(buildUpstreamParams(params).toString()).not.toContain('v=')
  })
})

describe('parseOpenMeteoTime (S3 regression)', () => {
  it('parses IST +05:30 (the canonical offset)', () => {
    const d = parseOpenMeteoTime('2026-07-26T00:00+05:30')
    expect(d.toISOString()).toBe('2026-07-25T18:30:00.000Z')
  })
})

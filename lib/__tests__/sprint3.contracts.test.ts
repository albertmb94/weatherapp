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
    // B-NBT-8: calibrated bucket (backtest 2026-08-15..22) rescaled by
    // the AI reserve of 0.20: ecmwf_ifs 0.102 â†’ 0.0816, gfs_global
    // 0.062 â†’ 0.0496. The AI reserve now only holds the unverifiable
    // models (aifs025 22/34, graphcast025 12/34): aifs gets
    // (22/34) Ã— 0.20 â‰ˆ 0.1294.
    expect(w.ecmwf_ifs).toBeCloseTo(0.102 * 0.8, 3)
    expect(w.gfs_global).toBeCloseTo(0.062 * 0.8, 3)
    expect(w.ecmwf_aifs025).toBeCloseTo((22 / 34) * 0.2, 5)
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
  it('is no longer the public API surface â€” covered by getMetricWeights', () => {
    expect(typeof computeDynamicWeights).toBe('function')
  })
})

describe('weightedAvg bias correction (S3/S10 groundwork)', () => {
  it('subtracts the per-model bias before averaging', () => {
    const values = [10, 20]
    const weights = [1, 1]
    const modelIds = ['a', 'b']
    // Bias of +5 on `a` shifts its contribution from 10 â†’ 5.
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

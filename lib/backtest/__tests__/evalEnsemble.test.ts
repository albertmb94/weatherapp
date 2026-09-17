import { describe, it, expect } from 'vitest'
import {
  assignFolds,
  bestSingleModel,
  bordaWeights,
  ensembleError,
  meanBias,
  type AccuracySample,
  type JoinedSample,
} from '@/lib/backtest/evalEnsemble'

describe('assignFolds', () => {
  it('is deterministic and assigns every key within [0, k)', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const first = assignFolds(keys, 3)
    const second = assignFolds(keys, 3)
    expect([...first.entries()]).toEqual([...second.entries()])
    for (const key of keys) {
      const f = first.get(key)!
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(3)
    }
  })

  it('uses at least two folds', () => {
    const folds = assignFolds(['a', 'b', 'c', 'd'], 1)
    expect(Math.max(...folds.values())).toBeLessThanOrEqual(1)
  })
})

describe('bordaWeights', () => {
  it('ranks the consistently better model higher', () => {
    const rows: AccuracySample[] = [
      { model_id: 'good', lat: 1, lon: 1, rmse: 1 },
      { model_id: 'bad', lat: 1, lon: 1, rmse: 2 },
      { model_id: 'ok', lat: 1, lon: 1, rmse: 1.5 },
      { model_id: 'good', lat: 2, lon: 2, rmse: 1 },
      { model_id: 'bad', lat: 2, lon: 2, rmse: 2 },
      { model_id: 'ok', lat: 2, lon: 2, rmse: 1.5 },
    ]
    const w = bordaWeights(rows)
    expect(w.good).toBeGreaterThan(w.ok)
    expect(w.ok).toBeGreaterThan(w.bad)
  })

  it('drops locations with too few models', () => {
    const rows: AccuracySample[] = [
      { model_id: 'a', lat: 1, lon: 1, rmse: 1 },
      { model_id: 'b', lat: 1, lon: 1, rmse: 2 },
    ]
    expect(bordaWeights(rows, 3)).toEqual({})
  })

  it('ignores non-positive / non-finite RMSE rows', () => {
    const rows: AccuracySample[] = [
      { model_id: 'a', lat: 1, lon: 1, rmse: 1 },
      { model_id: 'b', lat: 1, lon: 1, rmse: 2 },
      { model_id: 'c', lat: 1, lon: 1, rmse: 3 },
      { model_id: 'zero', lat: 1, lon: 1, rmse: 0 },
      { model_id: 'null', lat: 1, lon: 1, rmse: null },
    ]
    const w = bordaWeights(rows)
    expect(w.zero).toBeUndefined()
    expect(w.null).toBeUndefined()
  })
})

describe('meanBias', () => {
  it('weights each model bias by its sample count', () => {
    const rows: AccuracySample[] = [
      { model_id: 'a', lat: 1, lon: 1, rmse: 1, bias: 2, sample_count: 1 },
      { model_id: 'a', lat: 2, lon: 2, rmse: 1, bias: 0, sample_count: 3 },
    ]
    expect(meanBias(rows).a).toBeCloseTo(0.5, 6)
  })

  it('skips missing biases', () => {
    const rows: AccuracySample[] = [{ model_id: 'a', lat: 1, lon: 1, rmse: 1, bias: null }]
    expect(meanBias(rows)).toEqual({})
  })
})

describe('bestSingleModel', () => {
  it('picks the lowest mean RMSE', () => {
    const rows: AccuracySample[] = [
      { model_id: 'a', lat: 1, lon: 1, rmse: 3, sample_count: 1 },
      { model_id: 'b', lat: 1, lon: 1, rmse: 1, sample_count: 1 },
    ]
    expect(bestSingleModel(rows)).toBe('b')
  })
})

describe('ensembleError', () => {
  it('computes the weighted-mean error against the observation', () => {
    // Two equal models: (10 + 20)/2 = 15 vs observed 16 → err 1
    const samples = [{ observed: 16, byModel: { a: 10, b: 20 } }]
    const s = ensembleError(samples, { a: 1, b: 1 })
    expect(s.rmse).toBeCloseTo(1, 6)
    expect(s.mae).toBeCloseTo(1, 6)
    expect(s.n).toBe(1)
  })

  it('de-biases each model before weighting', () => {
    // (10-2 + 20-(-1)) / 2 = 14.5 vs 15 → err 0.5
    const samples = [{ observed: 15, byModel: { a: 10, b: 20 } }]
    const s = ensembleError(samples, { a: 1, b: 1 }, { a: 2, b: -1 })
    expect(s.rmse).toBeCloseTo(0.5, 6)
  })

  it('renormalises over the models present and skips empty instances', () => {
    const samples: JoinedSample[] = [
      { observed: 10, byModel: { a: 10 } }, // b missing → weight renormalises to a
      { observed: 5, byModel: {} }, // no model → skipped
    ]
    const s = ensembleError(samples, { a: 1, b: 1 })
    expect(s.n).toBe(1)
    expect(s.rmse).toBeCloseTo(0, 6)
  })

  it('computes precipitation contingency skill (POD/FAR/CSI)', () => {
    const samples: JoinedSample[] = [
      { observed: 1, byModel: { a: 1 } }, // hit
      { observed: 1, byModel: { a: 0 } }, // miss
      { observed: 0, byModel: { a: 1 } }, // false alarm
      { observed: 0, byModel: { a: 0 } }, // correct negative
    ]
    const s = ensembleError(samples, { a: 1 }, null, 0.1)
    expect(s.hits).toBe(1)
    expect(s.misses).toBe(1)
    expect(s.falseAlarms).toBe(1)
    expect(s.pod).toBeCloseTo(0.5, 6)
    expect(s.far).toBeCloseTo(0.5, 6)
    expect(s.csi).toBeCloseTo(1 / 3, 6)
  })
})

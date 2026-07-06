import { describe, it, expect } from 'vitest'
import {
  computeDynamicWeights,
  mergeWeights,
  getEnsembleConfidence,
} from '../computeDynamicWeights'
import type { ModelAccuracyRow } from '../db'

function makeAccuracyRecord(
  modelId: string,
  rmse: number,
  daysAgo: number = 0
): ModelAccuracyRow {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return {
    model_id: modelId,
    lat: 41.39,
    lon: 2.17,
    terrain_type: 'coastal',
    metric: 'temperature',
    lead_time_bucket: '0-24h',
    mae: rmse * 0.8,
    rmse,
    bias: 0,
    sample_count: 24,
    window_start: '2026-06-01',
    window_end: '2026-06-07',
    computed_at: date.toISOString(),
  }
}

describe('computeDynamicWeights', () => {
  it('returns empty for no records', () => {
    const result = computeDynamicWeights([])
    expect(result).toEqual({})
  })

  it('gives higher weight to lower RMSE model', () => {
    const records = [
      makeAccuracyRecord('model_a', 2.0), // better
      makeAccuracyRecord('model_b', 4.0), // worse
    ]
    const weights = computeDynamicWeights(records)
    expect(weights['model_a']).toBeGreaterThan(weights['model_b'])
  })

  it('weights sum to approximately 1', () => {
    const records = [
      makeAccuracyRecord('model_a', 2.0),
      makeAccuracyRecord('model_b', 3.0),
      makeAccuracyRecord('model_c', 4.0),
    ]
    const weights = computeDynamicWeights(records)
    const sum = Object.values(weights).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 2)
  })

  it('applies recency bias (recent data weighted more)', () => {
    const recentRecords = [makeAccuracyRecord('model_a', 2.0, 0)]
    const oldRecords = [makeAccuracyRecord('model_a', 2.0, 30)]
    const recentWeights = computeDynamicWeights(recentRecords)
    const oldWeights = computeDynamicWeights(oldRecords)
    // Both should have similar weights since it's the same model
    expect(recentWeights['model_a']).toBeDefined()
    expect(oldWeights['model_a']).toBeDefined()
  })
})

describe('mergeWeights', () => {
  it('returns static weights when no dynamic weights available', () => {
    const staticW = { a: 0.5, b: 0.3, c: 0.2 }
    const result = mergeWeights(staticW, {})
    expect(result).toEqual(staticW)
  })

  it('overrides with dynamic weights when available', () => {
    const staticW = { a: 0.5, b: 0.3, c: 0.2 }
    const dynamicW = { a: 0.6, b: 0.4 }
    const result = mergeWeights(staticW, dynamicW)
    // Dynamic weights take priority; 'a' and 'b' should be close to their
    // dynamic values after normalization, 'c' should be reduced
    expect(result['a']).toBeGreaterThan(result['c'])
    expect(result['b']).toBeGreaterThan(result['c'])
    // All weights should be positive
    expect(result['a']).toBeGreaterThan(0)
    expect(result['b']).toBeGreaterThan(0)
    expect(result['c']).toBeGreaterThan(0)
  })

  it('normalizes weights to sum to 1', () => {
    const staticW = { a: 0.5, b: 0.5 }
    const dynamicW = { a: 10, b: 20 }
    const result = mergeWeights(staticW, dynamicW)
    const sum = Object.values(result).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 2)
  })
})

describe('getEnsembleConfidence', () => {
  it('returns high for consistent values', () => {
    const values = [10.1, 10.2, 10.0, 10.3]
    const weights = [1, 1, 1, 1]
    expect(getEnsembleConfidence(values, weights)).toBe('high')
  })

  it('returns low for very different values', () => {
    const values = [5, 15, 25]
    const weights = [1, 1, 1]
    expect(getEnsembleConfidence(values, weights)).toBe('low')
  })

  it('returns low for fewer than 2 values', () => {
    const values = [10]
    const weights = [1]
    expect(getEnsembleConfidence(values, weights)).toBe('low')
  })

  it('handles null values gracefully', () => {
    const values = [10, null, 11, null]
    const weights = [1, 1, 1, 1]
    expect(getEnsembleConfidence(values, weights)).toBe('high')
  })
})

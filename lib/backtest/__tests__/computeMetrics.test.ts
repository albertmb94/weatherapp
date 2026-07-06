import { describe, it, expect } from 'vitest'
import {
  computeContinuousMetrics,
  computePrecipitationMetrics,
  computeMetrics,
} from '../computeMetrics'
import { leadTimeBucket } from '../fetchPreviousRuns'

describe('computeContinuousMetrics', () => {
  it('returns null for empty arrays', () => {
    const result = computeContinuousMetrics([], [])
    expect(result.mae).toBeNull()
    expect(result.rmse).toBeNull()
    expect(result.bias).toBeNull()
    expect(result.sampleCount).toBe(0)
  })

  it('computes MAE, RMSE, and Bias correctly', () => {
    const predicted = [10, 20, 30]
    const observed = [12, 18, 33]
    const result = computeContinuousMetrics(predicted, observed)
    // MAE = (2 + 2 + 3) / 3 = 2.333
    expect(result.mae).toBeCloseTo(2.333, 2)
    // RMSE = sqrt((4 + 4 + 9) / 3) = sqrt(5.666) = 2.381
    expect(result.rmse).toBeCloseTo(2.381, 2)
    // Bias = (-2 + 2 + (-3)) / 3 = -1
    expect(result.bias).toBeCloseTo(-1, 2)
    expect(result.sampleCount).toBe(3)
  })

  it('returns zero metrics for identical values', () => {
    const values = [10, 20, 30]
    const result = computeContinuousMetrics(values, values)
    expect(result.mae).toBe(0)
    expect(result.rmse).toBe(0)
    expect(result.bias).toBe(0)
  })
})

describe('computePrecipitationMetrics', () => {
  it('computes POD, FAR, CSI correctly', () => {
    // Hits: 2 (both predicted and observed >= 0.1)
    // Misses: 1 (observed >= 0.1 but predicted < 0.1)
    // False Alarms: 1 (predicted >= 0.1 but observed < 0.1)
    // Correct Negatives: 1 (both < 0.1)
    const predicted = [0.5, 0.0, 0.3, 0.0, 0.2]
    const observed = [0.5, 0.2, 0.0, 0.0, 0.3]
    const result = computePrecipitationMetrics(predicted, observed)
    // POD = 2 / (2 + 1) = 0.666
    expect(result.pod).toBeCloseTo(0.666, 2)
    // FAR = 1 / (2 + 1) = 0.333
    expect(result.far).toBeCloseTo(0.333, 2)
    // CSI = 2 / (2 + 1 + 1) = 0.5
    expect(result.csi).toBeCloseTo(0.5, 2)
  })

  it('handles all dry predictions', () => {
    const predicted = [0.0, 0.0, 0.0]
    const observed = [0.0, 0.0, 0.0]
    const result = computePrecipitationMetrics(predicted, observed)
    expect(result.pod).toBeNull()
    expect(result.far).toBeNull()
    expect(result.csi).toBeNull()
  })
})

describe('computeMetrics', () => {
  it('delegates to continuous for temperature', () => {
    const result = computeMetrics([10, 20], [12, 18], 'temperature')
    expect(result.mae).toBeDefined()
    expect(result.sampleCount).toBe(2)
  })

  it('delegates to precipitation for precipitation', () => {
    const result = computeMetrics([0.5, 0.0], [0.5, 0.2], 'precipitation')
    expect(result.pod).toBeDefined()
    expect(result.csi).toBeDefined()
  })
})

describe('leadTimeBucket', () => {
  it('returns correct buckets', () => {
    expect(leadTimeBucket(0)).toBe('0-24h')
    expect(leadTimeBucket(12)).toBe('0-24h')
    expect(leadTimeBucket(24)).toBe('0-24h')
    expect(leadTimeBucket(25)).toBe('24-48h')
    expect(leadTimeBucket(48)).toBe('24-48h')
    expect(leadTimeBucket(49)).toBe('48-72h')
    expect(leadTimeBucket(72)).toBe('48-72h')
    expect(leadTimeBucket(73)).toBe('72-96h')
    expect(leadTimeBucket(120)).toBe('96-120h')
    expect(leadTimeBucket(121)).toBe('120-168h')
    expect(leadTimeBucket(168)).toBe('120-168h')
  })
})

import { describe, it, expect } from 'vitest'
import calibration from '../calibration.generated.json'
import evaluation from '../../../docs/recalibration-2026-11-08.json'
import stations from '../../../docs/recalibration-stations-2026-11-08.json'
import { MODELS, ENSEMBLE_PRESETS, BASELINE_ENSEMBLE_PRESETS } from '../../models'

describe('published calibration release gates', () => {
  it('separates fitting, inner validation and final holdout dates', () => {
    expect(evaluation.from < evaluation.innerEnd).toBe(true)
    expect(evaluation.innerEnd < evaluation.trainEnd).toBe(true)
    expect(evaluation.trainEnd < evaluation.to).toBe(true)
    expect(stations.from > evaluation.trainEnd).toBe(true)
  })
  it('publishes only known models and normalized nonnegative weights', () => {
    for (const [metric, buckets] of Object.entries(calibration.weights)) {
      for (const [bucket, weights] of Object.entries(buckets)) {
        expect(Object.values(weights).every(w => w > 0 && Number.isFinite(w))).toBe(true)
        expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
        expect(Object.keys(weights).every(id => MODELS.some(m => m.id === id))).toBe(true)
        expect(ENSEMBLE_PRESETS.find(p => p.id === metric)!.weights[bucket]).toEqual(weights)
      }
    }
  })
  it('requires temporal improvement and no material station regression for promoted candidates', () => {
    for (const [key, result] of Object.entries(evaluation.buckets)) {
      const [metric, bucket] = key.split('/')
      if (!result.accepted) {
        expect(ENSEMBLE_PRESETS.find(p => p.id === metric)!.weights[bucket]).toEqual(BASELINE_ENSEMBLE_PRESETS.find(p => p.id === metric)!.weights[bucket])
        continue
      }
      expect(result.candidate.n).toBe(result.baseline.n)
      expect(result.candidate.rmse).toBeLessThan(result.baseline.rmse)
      const truth = stations.cells[key as keyof typeof stations.cells]
      expect(truth.release.n).toBeGreaterThan(500)
      // Regional station check is a non-inferiority guard, not a second
      // tuning dataset. The only station network here covers Catalonia.
      expect(truth.release.rmse).toBeLessThanOrEqual(truth.baseline.rmse * 1.01)
      if (metric === 'precipitation') {
        expect(result.candidate.csi).toBeGreaterThanOrEqual(result.baseline.csi)
        expect(truth.release.csi).toBeGreaterThanOrEqual(truth.baseline.csi * 0.99)
      }
    }
  })
})

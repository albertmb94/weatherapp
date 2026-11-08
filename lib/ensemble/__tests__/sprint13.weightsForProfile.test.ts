import { describe, it, expect } from 'vitest'
import { weightsFor, weightsForProfile, resolveActiveModels } from '../central'
import { MODELS, type MetricId } from '../../models'

// A release must use the exact algorithm evaluated on the held-out dates.
describe('validated weights are independent of unvalidated terrain boosts', () => {
  const active = resolveActiveModels(MODELS, [], 'wedai')
  for (const metric of ['temperature', 'precipitation', 'wind_speed', 'precipitation_probability'] as MetricId[]) {
    it(`${metric}: recommendations cannot change calibrated weights`, () => {
      const base = weightsFor(metric, 72, 1, active)
      expect(weightsForProfile(metric, 72, 1, active, new Set(['ecmwf_ifs']), 'coastal')).toEqual(base)
      expect(weightsForProfile(metric, 72, 1, active, new Set(['gfs_global']), 'mountain')).toEqual(base)
    })
  }
  it('keeps the manual selection aligned, including an empty selection', () => {
    expect(weightsForProfile('temperature', 0, 1, [], new Set(['ecmwf_ifs']), 'coastal')).toEqual([])
    const one = active.filter(m => m.id === 'gfs_global')
    expect(weightsForProfile('temperature', 0, 1, one, new Set(['ecmwf_ifs']), 'coastal')).toEqual(weightsFor('temperature', 0, 1, one))
  })
})
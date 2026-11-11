import { describe, expect, it } from 'vitest'
import { getLeadTimeBucket, ENSEMBLE_PRESETS } from '../../models'
import { attachForecastLead, forecastLeadAtHour } from '../forecastLead'
import { ensemblePresetWeights } from '../central'
import release from '../wind-calibration.generated.json'
import audit from '../../../docs/forecast-audit-2026-11-11.json'

describe('forecast reference and calibration release', () => {
  it('retains the weight bucket for the same hour after slicing an aged forecast', () => {
    const series: Record<string, Record<string, (number | null)[]>> = {}
    const fetchedAt = Date.UTC(2026, 10, 11, 10)
    const hours = [47, 48, 49].map(h => new Date(fetchedAt + (h + 1) * 3600000))
    attachForecastLead(series, hours, 3600, fetchedAt)
    const sliced = Object.fromEntries(Object.entries(series).map(([id, data]) => [id, { hours: data.hours.slice(2) }]))
    expect(getLeadTimeBucket(forecastLeadAtHour(series, 1, 1))).toBe('0-48h')
    expect(getLeadTimeBucket(forecastLeadAtHour(sliced, 0, 0))).toBe('48-96h')
  })

  it('publishes only wind speeds with recorded out-of-sample acceptance', () => {
    const previous = ENSEMBLE_PRESETS.find(p => p.id === 'wind_speed')!
    for (const [bucket, weights] of Object.entries(release.weights)) {
      const key = `wind_speed/${bucket}` as keyof typeof audit.results
      expect(audit.results[key].accepted).toBe(true)
      expect(audit.results[key].spatial.rmseDelta95?.high).toBeLessThan(0)
      expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1)
      expect(ensemblePresetWeights('wind_speed', bucket)).toEqual(weights)
      expect(ensemblePresetWeights('wind_gusts', bucket)).toEqual(previous.weights[bucket])
    }
    expect(ensemblePresetWeights('wind_speed', '168-240h')).toEqual(previous.weights['168-240h'])
    expect(ensemblePresetWeights('wind_speed', '0-48h', 23)).toEqual(previous.weights['0-48h'])
    expect(ensemblePresetWeights('wind_speed', '0-48h', 24)).toEqual(release.weights['0-48h'])
  })
})

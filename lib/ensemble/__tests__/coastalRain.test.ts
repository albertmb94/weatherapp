import { describe, it, expect } from 'vitest'
import { rainFactor, attachRainCalibration, adjustedEnsembleValue, RAIN_ADJUSTMENT_SERIES } from '../rainCalibration'
import { meanAtHour, meanOverBucket, ensembleWithFallback } from '../central'
import { MODELS } from '../../models'
import evidence from '../../../docs/coastal-rain-2026-11-08.json'
import release from '../coastal-rain.generated.json'

const now = Date.parse('2026-11-08T00:00Z')
describe('bounded local rainfall amount correction', () => {
  it('applies only at measured coordinates, supported leads and during its validity window', () => {
    expect(rainFactor(41.45215, 2.24757, 24, now)).toBe(release.corrections[0].factors['0-48h'])
    expect(rainFactor(41.45215, 2.24757, 12, now)).toBe(1)
    expect(rainFactor(41.45215, 2.24757, 169, now)).toBe(1)
    expect(rainFactor(40.42, -3.7, 48, now)).toBe(1)
    expect(rainFactor(41.45215, 2.24757, 48, Date.parse('2027-01-01T00:00Z'))).toBe(1)
  })
  it('keeps raw models unchanged and applies the same single correction to ensemble helpers', () => {
    const time = [new Date(now + 24 * 3600_000), new Date(now + 25 * 3600_000)]
    const series: Record<string, Record<string, (number | null)[]>> = { ecmwf_ifs: { precipitation: [4, 4], precipitation_probability: [70, 70] } }
    expect(attachRainCalibration(series, time, 41.45215, 2.24757, 0, now)).toBe(true)
    const models = MODELS.filter(m => m.id === 'ecmwf_ifs')
    const expected = 4 * release.corrections[0].factors['0-48h']
    expect(series.ecmwf_ifs.precipitation).toEqual([4, 4])
    expect(meanAtHour({ time, series }, 'precipitation', 0, models, [1])).toBeCloseTo(expected)
    expect(meanOverBucket({ time, series }, 'precipitation', 0, 1, models, () => [1])).toBeCloseTo(expected)
    expect(ensembleWithFallback(series, 'precipitation', 0, models, models, [1])).toBeCloseTo(expected)
    expect(meanAtHour({ time, series }, 'precipitation', 0, models, [1], null, false)).toBe(4)
    expect(adjustedEnsembleValue(series, 'precipitation_probability', 0, 70)).toBe(70)
    expect(adjustedEnsembleValue(series, 'precipitation', 0, null)).toBeNull()
    expect(series[RAIN_ADJUSTMENT_SERIES].precipitation).toHaveLength(time.length)
  })
  it('requires a disjoint local temporal holdout and improvements in amount and CSI', () => {
    for (const city of Object.values(evidence.cities)) {
      for (const result of Object.values(city.calibration)) {
        if (!result.accepted) continue
        expect(result.wetFit).toBeGreaterThanOrEqual(10)
        expect(result.wetTest).toBeGreaterThanOrEqual(5)
        expect(result.adjusted.n).toBe(result.raw.n)
        expect(result.adjusted.rmse).toBeLessThan(result.raw.rmse)
        expect(result.adjusted.mae).toBeLessThan(result.raw.mae)
        expect(result.adjusted.csi).toBeGreaterThanOrEqual(result.raw.csi)
      }
    }
    expect(release.trainEnd < release.to).toBe(true)
  })
})

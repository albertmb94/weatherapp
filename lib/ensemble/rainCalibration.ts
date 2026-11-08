import local from './coastal-rain.generated.json'
import { haversineKm } from '../geoDistance'
import { getLeadTimeBucket } from '../models'

/** Reserved series metadata, never a weather model or a raw forecast value.
 * Keeping factors on the same time axis makes slicing/offline persistence
 * preserve the calibration without changing the provider's model columns. */
export const RAIN_ADJUSTMENT_SERIES = '__ensemble_adjustments'
type Series = Record<string, Record<string, (number | null)[]>>

export function rainFactor(lat: number, lon: number, leadHours: number, asOf: number): number {
  // Local month-long evidence must not be extrapolated indefinitely, beyond
  // 5 km, to unverified leads, or to other seasons.
  if (asOf < Date.parse('2026-11-08T00:00Z') || asOf > Date.parse('2026-12-06T23:59:59Z')) return 1
  if (leadHours < local.minLeadHours || leadHours > local.maxLeadHours) return 1
  let best: typeof local.corrections[number] | undefined
  let distance = Infinity
  for (const cell of local.corrections) {
    const d = haversineKm([lat, lon], [cell.lat, cell.lon])
    if (d <= cell.radiusKm && d < distance) { best = cell; distance = d }
  }
  const factor = best?.factors[getLeadTimeBucket(leadHours) as keyof typeof local.corrections[number]['factors']]
  return typeof factor === 'number' && Number.isFinite(factor) && factor >= 0.25 && factor <= 1.25 ? factor : 1
}

export function attachRainCalibration(series: Series, time: Date[], lat: number, lon: number, offset: number, referenceMs: number): boolean {
  const localReference = referenceMs + offset * 1000
  const factors = time.map(t => rainFactor(lat, lon, (t.getTime() - localReference) / 3600_000, referenceMs))
  if (!factors.some(f => f !== 1)) return false
  series[RAIN_ADJUSTMENT_SERIES] = { precipitation: factors }
  return true
}

export function adjustedEnsembleValue(series: Series, metric: string, index: number, value: number | null): number | null {
  if (value === null || metric !== 'precipitation') return value
  const factor = series[RAIN_ADJUSTMENT_SERIES]?.precipitation?.[index]
  return typeof factor === 'number' && Number.isFinite(factor) && factor >= 0.25 && factor <= 1.25 ? Math.max(0, value * factor) : value
}

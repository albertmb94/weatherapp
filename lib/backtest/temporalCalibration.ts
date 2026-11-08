import { ensembleError, type JoinedSample } from './evalEnsemble'

export interface TimedSample extends JoinedSample { time: string; location: string }

export function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights).filter(([, w]) => Number.isFinite(w) && w > 0)
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  return Object.fromEntries(entries.map(([id, w]) => [id, w / total]))
}

/** Fit relative skill inside each location, then average across its footprint.
 * This avoids rewarding a regional merely for covering an easier climate. */
export function fitSkill(samples: readonly TimedSample[], power: number): Record<string, number> {
  const cells = new Map<string, Map<string, { sq: number; n: number }>>()
  for (const s of samples) {
    const models = cells.get(s.location) ?? new Map<string, { sq: number; n: number }>()
    for (const [id, v] of Object.entries(s.byModel)) {
      const cell = models.get(id) ?? { sq: 0, n: 0 }
      cell.sq += (v - s.observed) ** 2
      cell.n++
      models.set(id, cell)
    }
    cells.set(s.location, models)
  }
  const means = new Map<string, { sum: number; n: number }>()
  for (const models of cells.values()) {
    const valid = [...models].filter(([, c]) => c.n >= 48)
    if (valid.length < 3) continue
    const scale = valid.reduce((sum, [, c]) => sum + Math.sqrt(c.sq / c.n), 0) / valid.length || 1
    for (const [id, c] of valid) {
      const score = power === 0 ? 1 : (scale / Math.max(Math.sqrt(c.sq / c.n), scale * 0.25)) ** power
      const m = means.get(id) ?? { sum: 0, n: 0 }
      m.sum += score; m.n++
      means.set(id, m)
    }
  }
  return normalizeWeights(Object.fromEntries([...means].map(([id, c]) => [id, c.sum / c.n])))
}

/** Hyperparameter selection uses inner dates only. The final test window is
 * never consulted here. Static baseline fills genuinely unmeasured models. */
export function calibrateBucket(
  train: readonly TimedSample[], innerSplit: string, baseline: Record<string, number>,
): { weights: Record<string, number>; power: number; blend: number } {
  const fit = train.filter(s => s.time.slice(0, 10) <= innerSplit)
  const validation = train.filter(s => s.time.slice(0, 10) > innerSplit)
  if (!fit.length || !validation.length) throw new Error('Calibration requires both inner time windows')
  const base = normalizeWeights(baseline)
  let best = { weights: base, power: 0, blend: 0 }
  let score = ensembleError(validation, base).rmse
  for (const power of [0, 1, 2]) {
    const skill = fitSkill(fit, power)
    if (!Object.keys(skill).length) continue
    for (const blend of [0.25, 0.5, 0.75, 1]) {
      const weights = blendWeights(base, skill, blend)
      const stats = ensembleError(validation, weights)
      // Identical verification population is required before comparing errors.
      if (stats.n !== validation.length || !Number.isFinite(stats.rmse)) continue
      if (stats.rmse < score) {
        best = { weights, power, blend }; score = stats.rmse
      }
    }
  }
  return { ...best, weights: best.blend === 0 ? base : blendWeights(base, fitSkill(train, best.power), best.blend) }
}

function blendWeights(base: Record<string, number>, skill: Record<string, number>, fraction: number) {
  return normalizeWeights(Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(skill)])]
    .map(id => [id, (1 - fraction) * (base[id] ?? 0) + fraction * (skill[id] ?? 0)])))
}

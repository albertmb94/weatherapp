import type { TimedSample } from './temporalCalibration'
import { normalizeWeights } from './temporalCalibration'
import { ensembleError, type ErrorStats, type JoinedSample } from './evalEnsemble'

export type Weights = Record<string, number>

export function predictMembers(sample: JoinedSample, weights: Weights): number | null {
  let sum = 0
  let total = 0
  for (const [id, value] of Object.entries(sample.byModel)) {
    const weight = weights[id]
    if (!Number.isFinite(value) || !(weight > 0)) continue
    sum += weight * value
    total += weight
  }
  return total > 0 ? sum / total : null
}

/** Fits the error of the combined forecast itself, with the same
 * renormalization over available models that production uses. The
 * bounded log-weight offsets preserve prior support for sparse models. */
export function fitJointWeights(
  samples: readonly TimedSample[],
  prior: Weights,
  penalty: number,
): Weights {
  const ids = Object.keys(prior)
  const indices = new Map(ids.map((id, index) => [id, index]))
  const weights = ids.map(id => prior[id])
  const offsets = weights.map(() => 0)
  const data = samples.map(sample => ({
    target: sample.observed,
    members: Object.entries(sample.byModel).flatMap(([id, value]) => {
      const index = indices.get(id)
      return index === undefined ? [] : [{ index, value }]
    }),
  })).filter(sample => sample.members.length > 0)
  if (!data.length) return prior
  const variance = Math.max(ensembleError(samples, prior).rmse ** 2, 1e-6)
  const scale = 2 / (data.length * variance)
  const limit = Math.log(4)
  for (let step = 0; step < 60; step++) {
    const gradient = offsets.map(() => 0)
    for (const { target, members } of data) {
      let sum = 0
      let total = 0
      for (const { index, value } of members) {
        sum += weights[index] * value
        total += weights[index]
      }
      const estimate = sum / total
      const residual = (estimate - target) * scale / total
      for (const { index, value } of members) {
        gradient[index] += residual * weights[index] * (value - estimate)
      }
    }
    for (let index = 0; index < ids.length; index++) {
      const derivative = gradient[index] + 2 * penalty * offsets[index]
      offsets[index] = Math.max(-limit, Math.min(limit, offsets[index] - 0.7 * derivative))
      weights[index] = prior[ids[index]] * Math.exp(offsets[index])
    }
  }
  return normalizeWeights(Object.fromEntries(ids.map((id, i) => [id, weights[i]])))
}

export function noRegression(prior: ErrorStats, candidate: ErrorStats, rain: boolean, tolerance = 0): boolean {
  return prior.n > 0 && candidate.n === prior.n &&
    candidate.rmse <= prior.rmse * (1 + tolerance) &&
    (!rain || ((candidate.csi ?? 0) >= (prior.csi ?? 0) * (1 - tolerance) &&
      (candidate.pod ?? 0) >= (prior.pod ?? 0) * (1 - tolerance)))
}

/** Paired moving-block resampling by UTC day. All sites and lead offsets on
 * a date stay together. The reported interval is descriptive with short
 * holdouts and is never treated as independent hourly draws. */
export function pairedRmseInterval(samples: readonly TimedSample[], prior: Weights, candidate: Weights) {
  const byDay = new Map<string, { baseline: number; proposed: number; n: number }>()
  for (const sample of samples) {
    const a = predictMembers(sample, prior)
    const b = predictMembers(sample, candidate)
    if (a === null || b === null) continue
    const day = sample.time.slice(0, 10)
    const row = byDay.get(day) ?? { baseline: 0, proposed: 0, n: 0 }
    row.baseline += (a - sample.observed) ** 2
    row.proposed += (b - sample.observed) ** 2
    row.n++
    byDay.set(day, row)
  }
  const days = [...byDay.keys()].sort()
  if (days.length < 7) return null
  let seed = 73
  const draws = Array.from({ length: 1000 }, () => {
    let baseline = 0, proposed = 0, count = 0
    for (let i = 0; i < days.length; i += 3) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const start = seed % (days.length - 2)
      for (let j = 0; j < Math.min(3, days.length - i); j++) {
        const row = byDay.get(days[start + j])!
        baseline += row.baseline
        proposed += row.proposed
        count += row.n
      }
    }
    return Math.sqrt(proposed / count) - Math.sqrt(baseline / count)
  }).sort((a, b) => a - b)
  return { days: days.length, blockDays: 3, low: draws[25], high: draws[974] }
}

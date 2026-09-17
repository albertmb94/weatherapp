/**
 * Offline evaluation for the ensemble (Phase 0).
 *
 * Answers the only question that matters before trusting a weighting
 * change: does the weighted ensemble actually beat the alternatives on
 * data it was NOT calibrated on?
 *
 * Method — leave-locations-out:
 *   1. Split the reference locations into K folds.
 *   2. For each fold, derive the weights (and optional bias) from the
 *      OTHER folds only (`model_accuracy` rows).
 *   3. Score every scheme on the held-out fold using the RAW
 *      `forecast_archive` × `observations_era5` pairs, so the number is a
 *      true ensemble RMSE, not a mean of per-model RMSEs.
 *
 * Everything here is pure and deterministic so the evaluation can be
 * unit-tested without a database.
 */

export interface AccuracySample {
  model_id: string
  lat: number
  lon: number
  rmse: number | null
  bias?: number | null
  sample_count?: number
}

export interface JoinedSample {
  /** Observation at the forecast's valid time. */
  observed: number
  /** Predicted value per model for this (location, valid time, lead). */
  byModel: Record<string, number>
}

export interface ErrorStats {
  rmse: number
  mae: number
  /** Number of (location, valid time, lead) instances that scored. */
  n: number
  /** Categorical contingency counts at `threshold` (wet = value ≥ threshold). */
  hits: number
  misses: number
  falseAlarms: number
  /** Probability of detection = hits / (hits + misses). */
  pod: number | null
  /** False-alarm ratio = falseAlarms / (hits + falseAlarms). */
  far: number | null
  /** Critical success index = hits / (hits + misses + falseAlarms). */
  csi: number | null
}

/** Rain-event threshold (mm/h), matching the backtest's own verifier. */
export const PRECIP_THRESHOLD = 0.1

/** Deterministic location → fold assignment (0..k-1). Same input, same
 *  split, so runs are reproducible and folds are comparable. */
export function assignFolds(keys: readonly string[], k: number): Map<string, number> {
  const folds = new Map<string, number>()
  const safeK = Math.max(2, Math.floor(k))
  for (const key of keys) {
    let h = 2166136261
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    folds.set(key, Math.abs(h) % safeK)
  }
  return folds
}

export function locationKey(lat: number, lon: number): string {
  return `${lat}|${lon}`
}

/**
 * Per-location Borda win-rate weights (same scoring the calibrator uses):
 * within each location rank the present models by RMSE and award
 * (n - rank) / n points, then average each model over the locations where
 * it verifies. Not renormalised here — `ensembleError` renormalises over
 * whichever models are present at each instance, exactly like
 * `weightedAvg`. Locations with fewer than `minModels` usable rows are
 * dropped (they can't rank meaningfully).
 */
export function bordaWeights(
  rows: readonly AccuracySample[],
  minModels = 3
): Record<string, number> {
  const byLocation = new Map<string, { model_id: string; rmse: number }[]>()
  for (const row of rows) {
    if (row.rmse === null || !Number.isFinite(row.rmse) || row.rmse <= 0) continue
    const key = locationKey(row.lat, row.lon)
    const list = byLocation.get(key) ?? []
    list.push({ model_id: row.model_id, rmse: row.rmse })
    byLocation.set(key, list)
  }

  const sums = new Map<string, number>()
  const counts = new Map<string, number>()
  for (const list of byLocation.values()) {
    if (list.length < minModels) continue
    const sorted = [...list].sort((a, b) => a.rmse - b.rmse)
    const n = sorted.length
    for (let i = 0; i < n; i++) {
      const { model_id } = sorted[i]
      sums.set(model_id, (sums.get(model_id) ?? 0) + (n - i) / n)
      counts.set(model_id, (counts.get(model_id) ?? 0) + 1)
    }
  }

  const weights: Record<string, number> = {}
  for (const [modelId, sum] of sums) {
    weights[modelId] = sum / (counts.get(modelId) ?? 1)
  }
  return weights
}

/** Sample-count-weighted mean bias per model (de-biasing map). */
export function meanBias(rows: readonly AccuracySample[]): Record<string, number> {
  const num = new Map<string, number>()
  const den = new Map<string, number>()
  for (const row of rows) {
    if (row.bias === null || row.bias === undefined || !Number.isFinite(row.bias)) continue
    const n = row.sample_count ?? 1
    if (n <= 0) continue
    num.set(row.model_id, (num.get(row.model_id) ?? 0) + row.bias * n)
    den.set(row.model_id, (den.get(row.model_id) ?? 0) + n)
  }
  const out: Record<string, number> = {}
  for (const [modelId, value] of num) {
    const total = den.get(modelId) ?? 0
    if (total > 0) out[modelId] = value / total
  }
  return out
}

/** Best single model by mean RMSE (used as a baseline). */
export function bestSingleModel(rows: readonly AccuracySample[]): string | null {
  const num = new Map<string, number>()
  const den = new Map<string, number>()
  for (const row of rows) {
    if (row.rmse === null || !Number.isFinite(row.rmse)) continue
    const n = row.sample_count ?? 1
    num.set(row.model_id, (num.get(row.model_id) ?? 0) + row.rmse * n)
    den.set(row.model_id, (den.get(row.model_id) ?? 0) + n)
  }
  let best: string | null = null
  let bestRmse = Infinity
  for (const [modelId, value] of num) {
    const mean = value / (den.get(modelId) ?? 1)
    if (mean < bestRmse) {
      bestRmse = mean
      best = modelId
    }
  }
  return best
}

/**
 * RMSE / MAE of the weighted ensemble over joined raw samples.
 *
 * `weights` is a model→weight map (renormalised per instance over the
 * models present); `bias` optionally de-biases each model first. Samples
 * where no model is present are skipped.
 */
export function ensembleError(
  samples: readonly JoinedSample[],
  weights: Record<string, number>,
  bias?: Record<string, number> | null,
  threshold: number = PRECIP_THRESHOLD
): ErrorStats {
  let sq = 0
  let abs = 0
  let n = 0
  let hits = 0
  let misses = 0
  let falseAlarms = 0
  for (const sample of samples) {
    let sum = 0
    let wSum = 0
    for (const [modelId, value] of Object.entries(sample.byModel)) {
      if (!Number.isFinite(value)) continue
      const w = weights[modelId]
      if (w === undefined || w <= 0) continue
      const corrected = bias?.[modelId] !== undefined ? value - (bias[modelId] as number) : value
      sum += corrected * w
      wSum += w
    }
    if (wSum <= 0) continue
    const ens = sum / wSum
    const err = ens - sample.observed
    sq += err * err
    abs += Math.abs(err)
    n++
    const predWet = ens >= threshold
    const obsWet = sample.observed >= threshold
    if (predWet && obsWet) hits++
    else if (!predWet && obsWet) misses++
    else if (predWet && !obsWet) falseAlarms++
  }
  const empty: ErrorStats = {
    rmse: NaN, mae: NaN, n: 0,
    hits: 0, misses: 0, falseAlarms: 0, pod: null, far: null, csi: null,
  }
  if (n === 0) return empty
  return {
    rmse: Math.sqrt(sq / n),
    mae: abs / n,
    n,
    hits,
    misses,
    falseAlarms,
    pod: hits + misses > 0 ? hits / (hits + misses) : null,
    far: hits + falseAlarms > 0 ? falseAlarms / (hits + falseAlarms) : null,
    csi: hits + misses + falseAlarms > 0 ? hits / (hits + misses + falseAlarms) : null,
  }
}

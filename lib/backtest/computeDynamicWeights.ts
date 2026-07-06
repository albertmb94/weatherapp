/**
 * Compute dynamic weights from backtesting accuracy data.
 * Weights are inversely proportional to RMSE with exponential decay
 * for recency bias.
 */

import type { ModelAccuracyRow } from './db'

/**
 * Compute dynamic weights for a set of models based on their accuracy records.
 * Returns a normalized weight map: model_id -> weight (sums to 1).
 *
 * @param accuracyRecords - Recent accuracy records from the database
 * @param decayFactor - How much to weight recent data (0.95 = 5% decay per day)
 * @param minWeight - Minimum weight for any model (prevents total exclusion)
 */
export function computeDynamicWeights(
  accuracyRecords: ModelAccuracyRow[],
  decayFactor: number = 0.95,
  minWeight: number = 0.01
): Record<string, number> {
  if (accuracyRecords.length === 0) return {}

  // Group by model_id
  const byModel = new Map<string, ModelAccuracyRow[]>()
  for (const record of accuracyRecords) {
    const existing = byModel.get(record.model_id) ?? []
    existing.push(record)
    byModel.set(record.model_id, existing)
  }

  // Compute weighted RMSE for each model
  const rawWeights = new Map<string, number>()
  const now = Date.now()

  for (const [modelId, records] of byModel) {
    let weightedRmse = 0
    let weightSum = 0

    for (const record of records) {
      if (record.rmse === null) continue
      const computedAt = new Date(record.computed_at).getTime()
      const daysAgo = (now - computedAt) / (86400 * 1000)
      const recencyWeight = Math.pow(decayFactor, daysAgo)
      weightedRmse += record.rmse * recencyWeight
      weightSum += recencyWeight
    }

    if (weightSum > 0) {
      const avgRmse = weightedRmse / weightSum
      // Weight is inverse of RMSE (lower RMSE = higher weight)
      rawWeights.set(modelId, 1 / Math.max(avgRmse, 0.1))
    }
  }

  if (rawWeights.size === 0) return {}

  // Normalize weights to sum to 1
  const totalWeight = Array.from(rawWeights.values()).reduce((a, b) => a + b, 0)
  const normalized: Record<string, number> = {}

  for (const [modelId, weight] of rawWeights) {
    normalized[modelId] = Math.max(weight / totalWeight, minWeight)
  }

  // Re-normalize after applying minimum
  const renormTotal = Object.values(normalized).reduce((a, b) => a + b, 0)
  for (const modelId of Object.keys(normalized)) {
    normalized[modelId] /= renormTotal
  }

  return normalized
}

/**
 * Merge dynamic weights with static weights.
 * Dynamic weights take priority when available; static weights
 * serve as fallback for models without accuracy data.
 */
export function mergeWeights(
  staticWeights: Record<string, number>,
  dynamicWeights: Record<string, number>
): Record<string, number> {
  const merged: Record<string, number> = {}

  // Start with static weights
  for (const [modelId, weight] of Object.entries(staticWeights)) {
    merged[modelId] = weight
  }

  // Override with dynamic weights where available
  const dynamicModelIds = new Set(Object.keys(dynamicWeights))
  if (dynamicModelIds.size > 0) {
    // Models with dynamic weights get their dynamic values
    for (const [modelId, weight] of Object.entries(dynamicWeights)) {
      merged[modelId] = weight
    }

    // Models without dynamic weights get reduced weight (0.5x their static weight)
    for (const modelId of Object.keys(merged)) {
      if (!dynamicModelIds.has(modelId)) {
        merged[modelId] *= 0.5
      }
    }

    // Re-normalize
    const total = Object.values(merged).reduce((a, b) => a + b, 0)
    if (total > 0) {
      for (const modelId of Object.keys(merged)) {
        merged[modelId] /= total
      }
    }
  }

  return merged
}

/**
 * Get a confidence level based on ensemble agreement.
 * Low variance between models = high confidence.
 */
export function getEnsembleConfidence(
  values: (number | null)[],
  weights: number[]
): 'high' | 'medium' | 'low' {
  const validValues: number[] = []
  const validWeights: number[] = []

  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null && values[i] !== undefined) {
      validValues.push(values[i]!)
      validWeights.push(weights[i])
    }
  }

  if (validValues.length < 2) return 'low'

  // Compute weighted mean
  const totalWeight = validWeights.reduce((a, b) => a + b, 0)
  const mean = validValues.reduce((sum, v, i) => sum + v * validWeights[i], 0) / totalWeight

  // Compute weighted variance
  const variance = validValues.reduce((sum, v, i) => {
    const diff = v - mean
    return sum + diff * diff * validWeights[i]
  }, 0) / totalWeight

  const stdDev = Math.sqrt(variance)

  // Thresholds based on typical weather variable ranges
  // Temperature: stdDev < 1°C = high, < 2.5°C = medium
  // Wind: stdDev < 2 km/h = high, < 5 km/h = medium
  if (stdDev < 1.5) return 'high'
  if (stdDev < 3) return 'medium'
  return 'low'
}

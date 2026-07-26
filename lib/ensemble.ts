/**
 * Weighted average across model values at a single time index.
 * Skips null/undefined entries; returns null if no model contributed.
 *
 * @param values - Array of model values (may contain nulls)
 * @param weights - Array of static weights (same length as values)
 * @param dynamicWeights - Optional map of model_id -> dynamic weight.
 *   When provided, overrides static weights for matching models.
 * @param modelIds - Array of model IDs corresponding to each value.
 *   Required when using dynamicWeights to look up per-model weights.
 * @param biasCorrection - Optional map of model_id -> additive bias (in the
 *   same unit as `values`). When provided, the bias is subtracted from
 *   each model value before weighting so systematic over/under-prediction
 *   doesn't drag the ensemble. Defaults to no correction.
 */
export function weightedAvg(
  values: (number | null)[],
  weights: number[],
  dynamicWeights?: Record<string, number> | null,
  modelIds?: string[],
  biasCorrection?: Record<string, number> | null
): number | null {
  const effectiveWeights = dynamicWeights && modelIds
    ? weights.map((w, i) => {
        const modelId = modelIds[i]
        const dynamicW = modelId ? dynamicWeights[modelId] : undefined
        return dynamicW !== undefined ? dynamicW : w
      })
    : weights

  let sum = 0
  let wSum = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === null || v === undefined) continue
    let adjusted = v
    if (biasCorrection && modelIds) {
      const bias = modelIds[i] ? biasCorrection[modelIds[i]] : undefined
      if (typeof bias === 'number' && Number.isFinite(bias)) adjusted = v - bias
    }
    sum += adjusted * effectiveWeights[i]
    wSum += effectiveWeights[i]
  }
  return wSum > 0 ? sum / wSum : null
}

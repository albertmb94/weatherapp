/**
 * Weighted average across model values at a single time index.
 * Skips null/undefined entries; returns null if no model contributed.
 *
 * @param values - Array of model values (may contain nulls)
 * @param weights - Array of static weights (same length as values)
 * @param dynamicWeights - Optional map of model_id -> dynamic weight.
 *   When provided, overrides static weights for matching models.
 * @param modelIds - Optional array of model IDs corresponding to each value.
 *   Required when using dynamicWeights to look up per-model weights.
 */
export function weightedAvg(
  values: (number | null)[],
  weights: number[],
  dynamicWeights?: Record<string, number> | null,
  modelIds?: string[]
): number | null {
  const effectiveWeights = dynamicWeights && modelIds
    ? weights.map((w, i) => {
        const modelId = modelIds[i]
        const dynamicW = modelId ? dynamicWeights[modelId] : undefined
        return dynamicW !== undefined ? dynamicW : w
      })
    : dynamicWeights
      ? weights.map((w, i) => {
          const dynamicW = dynamicWeights[String(i)]
          return dynamicW !== undefined ? dynamicW : w
        })
      : weights

  let sum = 0
  let wSum = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v !== null && v !== undefined) {
      sum += v * effectiveWeights[i]
      wSum += effectiveWeights[i]
    }
  }
  return wSum > 0 ? sum / wSum : null
}

/**
 * Compute ensemble weights for a given metric and lead time from preset definitions.
 * Returns an array of weights in the same order as the input model IDs.
 *
 * @param modelIds - Array of model IDs to compute weights for
 * @param ensembleWeights - The ensemble preset's weight map for the relevant bucket
 * @returns Array of weights, normalized to sum to 1
 */
export function getEnsembleWeights(
  modelIds: string[],
  ensembleWeights: Record<string, number>
): number[] {
  const raw = modelIds.map(id => ensembleWeights[id] ?? 0)
  const sum = raw.reduce((a, b) => a + b, 0)
  if (sum === 0) return modelIds.map(() => 1 / modelIds.length)
  return raw.map(w => w / sum)
}

export function contrastText(rgb: string): string {
  const match = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/)
  if (!match) return '#fff'
  const r = parseInt(match[1])
  const g = parseInt(match[2])
  const b = parseInt(match[3])
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.55 ? '#0a0a0a' : '#fff'
}

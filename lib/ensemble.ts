/**
 * Weighted average across model values at a single time index.
 * Skips null/undefined entries; returns null if no model contributed.
 *
 * @param values - Array of model values (may contain nulls)
 * @param weights - Array of static weights (same length as values)
 * @param dynamicWeights - Optional map of model_id -> dynamic weight.
 *   When provided, overrides static weights for matching models.
 *   Keys are model IDs; values are the dynamic weights to use.
 */
export function weightedAvg(
  values: (number | null)[],
  weights: number[],
  dynamicWeights?: Record<string, number> | null
): number | null {
  const effectiveWeights = dynamicWeights
    ? weights.map((w, i) => {
        // We can't look up by model ID here since we only have values/weights.
        // Dynamic weights must be pre-mapped to the same order as values.
        // Use the dynamicWeights map if it has a matching entry.
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

export function contrastText(rgb: string): string {
  const match = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/)
  if (!match) return '#fff'
  const r = parseInt(match[1])
  const g = parseInt(match[2])
  const b = parseInt(match[3])
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.55 ? '#0a0a0a' : '#fff'
}

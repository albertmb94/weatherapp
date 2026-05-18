/**
 * Weighted average across model values at a single time index.
 * Skips null/undefined entries; returns null if no model contributed.
 */
export function weightedAvg(values: (number | null)[], weights: number[]): number | null {
  let sum = 0
  let wSum = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v !== null && v !== undefined) {
      sum += v * weights[i]
      wSum += weights[i]
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

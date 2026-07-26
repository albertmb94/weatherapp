import type { Locale } from './i18n'

/**
 * Bucket the ensemble spread into a 3-level confidence label.
 *
 * The thresholds are tuned for `temperature` (°C). Other metrics can
 * either scale their stdDev to °C-equivalent before calling this
 * helper, or copy it with metric-specific numbers. The default
 * mapping follows the heuristic found in B-10-5:
 *
 *  - < 1.5 °C  → "high" (the models essentially agree)
 *  - < 3.0 °C  → "medium" (one model disagrees but doesn't dominate)
 *  - ≥ 3.0 °C  → "low" (large divergence, treat the number as a guess)
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface ConfidenceBucket {
  level: ConfidenceLevel
  /** Per-metric thresholds the renderer should use to colour the chip. */
  threshold: { okMax: number; warnMax: number }
}

export function classifySpread(
  stdDev: number,
  thresholds: { okMax?: number; warnMax?: number } = {},
): ConfidenceBucket {
  const okMax = thresholds.okMax ?? 1.5
  const warnMax = thresholds.warnMax ?? 3
  const level: ConfidenceLevel =
    stdDev < okMax ? 'high' : stdDev < warnMax ? 'medium' : 'low'
  return { level, threshold: { okMax, warnMax } }
}

export function confidenceLabel(level: ConfidenceLevel, locale: Locale): string {
  if (locale === 'en') {
    return level === 'high' ? 'High' : level === 'medium' ? 'Medium' : 'Low'
  }
  return level === 'high' ? 'Alta' : level === 'medium' ? 'Media' : 'Baja'
}

export function confidenceToneClasses(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
    case 'medium':
      return 'text-amber-400 bg-amber-500/10 border-amber-500/30'
    case 'low':
      return 'text-rose-400 bg-rose-500/10 border-rose-500/30'
  }
}

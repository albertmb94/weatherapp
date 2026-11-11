import type { CSSProperties } from 'react'
import { getColor, type ScaleMetric } from '@/lib/colorScales'

const HEAT_STYLE_CACHE = new Map<string, CSSProperties>()
const HEAT_STYLE_CACHE_LIMIT = 5000

export function heatStyle(metric: ScaleMetric, value: number | null): CSSProperties | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined
  const key = `${metric}|${value}`
  const cached = HEAT_STYLE_CACHE.get(key)
  if (cached) return cached
  const style = { '--insights-cell-color': getColor(metric, value) } as CSSProperties
  if (HEAT_STYLE_CACHE.size >= HEAT_STYLE_CACHE_LIMIT) {
    let toDelete = HEAT_STYLE_CACHE.size - HEAT_STYLE_CACHE_LIMIT / 2
    for (const k of HEAT_STYLE_CACHE.keys()) {
      if (toDelete <= 0) break
      HEAT_STYLE_CACHE.delete(k)
      toDelete--
    }
  }
  HEAT_STYLE_CACHE.set(key, style)
  return style
}

export function __resetHeatStyleCacheForTests(): void {
  HEAT_STYLE_CACHE.clear()
}

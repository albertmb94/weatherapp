/**
 * Sprint 14: heatmap-cell background style helper, extracted from
 * `InsightsTable.tsx`. The same memoised cache + radial-gradient
 * builder is now usable from both `InsightsTable` and
 * `MobileInsightsCard` without one importing the other. Keeping the
 * helper in its own file also makes it easier to test the
 * intensity / colour mapping in isolation.
 *
 * IMPORTANT: the cell-style recipe (CSS custom property,
 * backgroundColor tint, radial-gradient with `--heat-cell-bg-size`)
 * is byte-equivalent to the inline implementation that lived in
 * InsightsTable.tsx before this extraction. Touching the formula
 * here would change the visual output of every existing Insights
 * row + the mobile cards — so don't.
 */

import type { CSSProperties } from 'react'
import { getColor, SCALES } from '@/lib/colorScales'
import type { ScaleMetric } from '@/lib/colorScales'

export const TRANSPARENT_STYLE: CSSProperties = { background: 'transparent' }

function rgbTriple(color: string): string {
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (m) return `${m[1]}, ${m[2]}, ${m[3]}`
  const hex = color.replace('#', '')
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 2), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return `${r}, ${g}, ${b}`
  }
  return '120, 120, 120'
}

function intensityFor(metric: ScaleMetric, value: number | null): number | null {
  if (value === null || value === undefined) return null
  const stops = SCALES[metric]
  if (!stops || stops.length === 0) return null
  let lo = stops[0]
  let hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (value >= stops[i].value && value <= stops[i + 1].value) {
      lo = stops[i]
      hi = stops[i + 1]
      break
    }
  }
  if (value <= stops[0].value) {
    lo = stops[0]
    hi = stops[0]
  } else if (value >= stops[stops.length - 1].value) {
    lo = stops[stops.length - 1]
    hi = stops[stops.length - 1]
  }
  const loDist = Math.abs(value - lo.value)
  const hiDist = Math.abs(value - hi.value)
  const range = Math.max(1, hi.value - lo.value)
  const proximity = 1 - (loDist + hiDist) / (range * 2)
  return Math.max(0.35, Math.min(1, 0.4 + proximity * 0.6))
}

const HEAT_STYLE_CACHE = new Map<string, CSSProperties>()
const HEAT_STYLE_CACHE_LIMIT = 5000

export function heatStyle(metric: ScaleMetric, value: number | null): CSSProperties {
  if (value === null || value === undefined) return TRANSPARENT_STYLE
  const key = `${metric}|${value}`
  const cached = HEAT_STYLE_CACHE.get(key)
  if (cached) return cached
  const color = getColor(metric, value)
  const triple = rgbTriple(color)
  const intensity = intensityFor(metric, value) ?? 0.5
  const core = Math.round(intensity * 45)
  const mid = Math.round(intensity * 18)
  const tintAlpha = 35
  const style = {
    ['--heat-rgb-triple' as string]: triple,
    backgroundColor: `rgba(${triple}, ${tintAlpha}%)`,
    backgroundImage: `radial-gradient(ellipse var(--heat-cell-bg-size, 32% 60%) at 50% 50%, rgba(${triple},${core}%) 0%, rgba(${triple},${mid})% 50%, rgba(${triple},0) 92%)`,
  } as CSSProperties
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
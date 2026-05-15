'use client'

import type { MetricId } from '@/lib/models'
import { SCALES, type ScaleMetric } from '@/lib/colorScales'

interface ColorLegendProps {
  metric: Exclude<MetricId, 'all'>
}

function buildGradientStops(metric: ScaleMetric): string {
  const stops = SCALES[metric]
  const maxVal = stops[stops.length - 1].value
  const minVal = stops[0].value
  const range = maxVal - minVal || 1
  return stops
    .map(s => {
      const pct = ((s.value - minVal) / range) * 100
      const [r, g, b] = s.color
      return `rgb(${r},${g},${b}) ${pct.toFixed(1)}%`
    })
    .join(', ')
}

export default function ColorLegend({ metric }: ColorLegendProps) {
  const stops = SCALES[metric as ScaleMetric]
  const gradient = buildGradientStops(metric as ScaleMetric)
  const minVal = stops[0].value
  const maxVal = stops[stops.length - 1].value
  const midVal = stops[Math.floor(stops.length / 2)]?.value

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div
          className="h-3 w-48 rounded-sm"
          style={{ background: `linear-gradient(to right, ${gradient})` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-gray-500 w-48">
        <span>{minVal}</span>
        {midVal !== undefined && <span>{midVal}</span>}
        <span>{maxVal}</span>
      </div>
    </div>
  )
}

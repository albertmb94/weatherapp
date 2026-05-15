'use client'

import type { MetricId } from '@/lib/models'
import { METRICS } from '@/lib/models'
import { getColor, SCALES, type ScaleMetric } from '@/lib/colorScales'

interface ColorLegendProps {
  metric: Exclude<MetricId, 'all'>
}

export default function ColorLegend({ metric }: ColorLegendProps) {
  const stops = SCALES[metric as ScaleMetric]
  const meta = METRICS.find(m => m.id === metric)
  const label = meta?.label ?? metric
  const unit = meta?.unit ?? ''

  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-gray-400 mr-1">{label}:</span>
      {stops.map((stop, i) => {
        const color = getColor(metric, stop.value)
        const next = stops[i + 1]
        const rangeLabel = next ? `${stop.value}–${next.value}` : `${stop.value}+`
        return (
          <div key={i} className="flex items-center gap-0.5">
            <div
              className="w-4 h-3 rounded-sm border border-gray-600"
              style={{ backgroundColor: color }}
            />
            <span className="text-gray-500 text-[10px]">
              {rangeLabel}
              {unit}
            </span>
          </div>
        )
      })}
    </div>
  )
}

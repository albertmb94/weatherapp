'use client'

import type { MetricId } from '@/lib/models'
import { METRICS } from '@/lib/models'
import { SCALES, type ScaleMetric } from '@/lib/colorScales'

interface ColorLegendProps {
  metric: MetricId
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
  const range = maxVal - minVal || 1
  const unit = METRICS.find(m => m.id === metric)?.unit ?? ''

  return (
    <div className="flex flex-col gap-0.5 max-w-[calc(100vw-40px)]">
      <div className="relative h-3 w-56 max-w-full">
        <div
          className="absolute inset-0 rounded-sm"
          style={{ background: `linear-gradient(to right, ${gradient})` }}
        />
        {stops.map((s, i) => {
          const pct = ((s.value - minVal) / range) * 100
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-px bg-black/40"
              style={{ left: `${pct}%` }}
            />
          )
        })}
      </div>
      <div className="relative h-3 w-56 max-w-full">
        {stops.map((s, i) => {
          const pct = ((s.value - minVal) / range) * 100
          const align = i === 0 ? 'left-0' : i === stops.length - 1 ? 'right-0' : ''
          const transform = i === 0 || i === stops.length - 1 ? undefined : 'translateX(-50%)'
          return (
            <span
              key={i}
              className={`absolute top-0 text-[9px] text-gray-400 ${align}`}
              style={{ left: align ? undefined : `${pct}%`, transform }}
            >
              {s.value}
            </span>
          )
        })}
      </div>
      <div className="text-[9px] text-gray-500 text-right w-56 max-w-full">{unit}</div>
    </div>
  )
}

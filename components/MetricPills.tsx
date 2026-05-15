'use client'

import type { Metric, MetricId } from '@/lib/models'

interface MetricPillsProps {
  metrics: Metric[]
  selected: MetricId
  onChange: (id: MetricId) => void
}

const ICONS: Record<string, string> = {
  all: '◫',
  temperature: '°',
  cloud_cover: '☁',
  wind_speed: '≋',
  wind_gusts: '⌇',
  precipitation: '⋮',
}

export default function MetricPills({ metrics, selected, onChange }: MetricPillsProps) {
  return (
    <div className="flex gap-0.5">
      {metrics.map(m => {
        const active = selected === m.id
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id as MetricId)}
            className={`px-2 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
              active
                ? 'bg-white/10 text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
            title={m.label}
          >
            <span>{ICONS[m.id]}</span>
          </button>
        )
      })}
    </div>
  )
}

'use client'

import type { Metric, MetricId } from '@/lib/models'

interface MetricPillsProps {
  metrics: Metric[]
  selected: MetricId
  onChange: (id: MetricId) => void
}

const ICONS: Record<MetricId, React.ReactNode> = {
  all: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  ),
  temperature: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <path d="M8 1.5v8.5" />
      <circle cx="8" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M6 10V4a2 2 0 1 1 4 0v6" />
    </svg>
  ),
  cloud_cover: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M4 12a3 3 0 0 1 .3-5.97A4 4 0 0 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
    </svg>
  ),
  wind_speed: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <path d="M2 5h7.5a1.5 1.5 0 1 0-1.5-1.5" />
      <path d="M2 8h10.5a2 2 0 1 1-2 2" />
      <path d="M2 11h5.5a1.5 1.5 0 1 1-1.5 1.5" />
    </svg>
  ),
  wind_gusts: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <path d="M2 4h9" />
      <path d="M2 8h12" />
      <path d="M2 12h6" />
      <path d="M11 4l2-1.5M14 8l2-1.5M8 12l2-1.5" strokeOpacity={0.6} />
    </svg>
  ),
  precipitation: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M8 2.5C8 2.5 4 7 4 10a4 4 0 0 0 8 0c0-3-4-7.5-4-7.5z" />
    </svg>
  ),
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
            className={`px-1.5 py-1 rounded text-xs font-medium transition-all cursor-pointer flex items-center justify-center ${
              active
                ? 'bg-white/10 text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
            title={m.label}
            aria-label={m.label}
            aria-pressed={active}
          >
            {ICONS[m.id]}
          </button>
        )
      })}
    </div>
  )
}

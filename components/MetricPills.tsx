'use client'

import type { Metric, MetricId } from '@/lib/models'

interface MetricPillsProps {
  metrics: Metric[]
  selected: MetricId
  onChange: (id: MetricId) => void
  group?: 'land' | 'marine'
}

const ICONS: Record<MetricId, React.ReactNode> = {
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
  humidity: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <path d="M8 14c3 0 5-2 5-5 0-4-5-8-5-8S3 5 3 9c0 3 2 5 5 5z" />
      <path d="M6 9.5c0 1 .9 2 2 2" strokeOpacity={0.7} />
    </svg>
  ),
  uv_index: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
      <path d="M8 1.5v2M8 12.5v2M3 3l1 1M12 12l1 1M1.5 8h2M12.5 8h2M4 12l-1 1M13 3l-1 1" strokeOpacity={0.7} />
    </svg>
  ),
  pressure: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4v4l2.5 2.5" />
      <path d="M5 13l-1 1M11 13l1 1" strokeOpacity={0.7} />
    </svg>
  ),
  dewpoint: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <path d="M8 2C8 2 4 6 4 9a4 4 0 0 0 8 0c0-3-4-7-4-7z" />
      <path d="M6 9.5c0 1.5 1.5 2.5 2 2.5" strokeOpacity={0.5} />
      <circle cx="12" cy="4" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  visibility: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  ),
  sea_surface_temperature: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M9.5 2.5a1.5 1.5 0 0 1 3 0v6a2.5 2.5 0 1 1-3 0z" />
      <path d="M1 13c1.3-1.6 2.6-1.6 4 0s2.7 1.6 4 0" strokeOpacity={0.6} />
    </svg>
  ),
  wave_height: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <path d="M1 10c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0" />
      <path d="M1 13c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0" strokeOpacity={0.6} />
    </svg>
  ),
  wave_period: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4v4l3 2" />
    </svg>
  ),
  wave_direction: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <path d="M8 2v8" />
      <path d="M5 7l3-3 3 3" />
      <path d="M2 13h12" strokeOpacity={0.5} />
    </svg>
  ),
  wind_wave_height: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <path d="M2 5h6.5a1.5 1.5 0 1 0-1.5-1.5" />
      <path d="M2 11c1.5-2 3-2 4.5 0s3 2 4.5 0" />
    </svg>
  ),
  wind_wave_period: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <path d="M2 8h4" />
      <path d="M7 8a3 3 0 0 1 6 0 3 3 0 0 1-3 3" />
    </svg>
  ),
  swell_wave_height: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M1 9c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0" />
      <path d="M1 12c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0" strokeOpacity={0.5} />
    </svg>
  ),
  swell_wave_period: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <path d="M2 11c2-3 4-3 6 0s4 3 6 0" />
      <path d="M2 6h2M6 6h2" strokeOpacity={0.6} />
    </svg>
  ),
}

export default function MetricPills({ metrics, selected, onChange, group }: MetricPillsProps) {
  const filtered = group ? metrics.filter(m => m.group === group) : metrics
  return (
    <div className="flex gap-0.5">
      {filtered.map(m => {
        const active = selected === m.id
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id as MetricId)}
            className={`min-w-[44px] min-h-[44px] px-1.5 py-1 rounded text-xs font-medium transition-all cursor-pointer flex items-center justify-center ${
              active
                ? 'bg-accent-soft text-accent'
                : 'text-text-tertiary hover:text-text-primary'
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

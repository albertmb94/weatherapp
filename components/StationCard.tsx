'use client'

import type { MeteoclimaticObservation } from '@/lib/meteoclimatic-types'

function tempColor(t: number | null | undefined): string {
  if (t == null) return 'text-gray-500'
  if (t >= 35) return 'text-red-500'
  if (t >= 30) return 'text-orange-400'
  if (t >= 25) return 'text-yellow-400'
  if (t >= 20) return 'text-amber-300'
  if (t >= 10) return 'text-sky-300'
  if (t >= 5) return 'text-blue-400'
  return 'text-blue-300'
}

function windArrow(dir: number | null): string {
  if (dir == null) return ''
  const arrows = ['↓','↙','←','↖','↑','↗','→','↘']
  return arrows[Math.round(dir / 45) % 8]
}

function fmt(v: number | null | undefined, d = 1): string {
  return v != null ? v.toFixed(d) : '—'
}

export default function StationCard({ station }: { station: MeteoclimaticObservation }) {
  const { temperature: t, humidity: h, wind: w, precipitation: p, name } = station

  return (
    <div className="bg-surface-raised border border-border rounded-lg px-3 py-2 hover:border-border-strong transition-all duration-200 hover:shadow-sm hover:-translate-y-0.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-text-primary truncate">{name}</span>
        <span className={`text-sm font-light tabular-nums ${tempColor(t.current)}`}>
          {fmt(t.current)}°
        </span>
      </div>

      <div className="flex items-center gap-x-3 gap-y-0.5 text-[10px] text-text-tertiary">
        {t.max != null && t.min != null && (
          <span>{fmt(t.max, 0)}↑ {fmt(t.min, 0)}↓</span>
        )}
        {h.current != null && (
          <span>{fmt(h.current, 0)}% 💧</span>
        )}
        {w.speed != null && (
          <span>{windArrow(w.bearing)} {fmt(w.speed, 0)}</span>
        )}
        {p != null && p > 0 && (
          <span className="text-sky-400">{fmt(p, 1)}mm</span>
        )}
      </div>
    </div>
  )
}

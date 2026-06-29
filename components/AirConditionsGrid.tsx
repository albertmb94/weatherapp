'use client'

import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import type { CurrentSnapshot } from '@/lib/friendlyForecast'

interface AirConditionsGridProps {
  snapshot: CurrentSnapshot | null
  title?: string
}

interface CardProps {
  label: string
  value: string
  unit?: string
  icon: React.ReactNode
  accent?: 'amber' | 'sky' | 'rose' | 'emerald'
}

function fmtTemp(value: number | null): string {
  return value === null ? '–' : `${Math.round(value)}°`
}

function fmtWind(value: number | null): string {
  if (value === null) return '–'
  return `${Math.round(value)}`
}

function fmtPercent(value: number | null): string {
  return value === null ? '–' : `${Math.round(value)}%`
}

function RealFeelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4 4 0 1 0 5 0z" />
    </svg>
  )
}

function WindIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
      <path d="M3 8h11a3 3 0 1 0-3-3" />
      <path d="M3 14h15a3 3 0 1 1-3 3" />
    </svg>
  )
}

function DropIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />
    </svg>
  )
}

function UvIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </svg>
  )
}

function AirCard({ label, value, unit, icon, accent = 'sky' }: CardProps) {
  const accentMap: Record<NonNullable<CardProps['accent']>, string> = {
    amber: 'text-amber-300 bg-amber-500/10',
    sky: 'text-sky-300 bg-sky-500/10',
    rose: 'text-rose-300 bg-rose-500/10',
    emerald: 'text-emerald-300 bg-emerald-500/10',
  }
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-3 md:p-4 flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-1.5 text-text-tertiary">
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${accentMap[accent]}`}>{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-wide truncate">{label}</span>
      </div>
      <div className="flex items-baseline gap-1 mt-1">
        <span className="text-2xl md:text-3xl font-semibold text-text-primary tabular-nums leading-none">
          {value}
        </span>
        {unit ? (
          <span className="text-xs text-text-tertiary tabular-nums">{unit}</span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Today's UV index, displayed alongside a small "UV peak" tag so the reading
 * stays meaningful at night and during the early morning when the raw current
 * UV is 0.
 */
function pickUvDisplay(snapshot: CurrentSnapshot | null): { value: string; unit: string } {
  if (snapshot === null) return { value: '–', unit: '' }
  const current = snapshot.uvIndex
  const peak = snapshot.uvIndexPeak
  // Prefer the raw current UV when there is any daylight reading; otherwise
  // show the day's peak so the card never reads 0.0 once the sun has been up.
  const raw = current !== null && current > 0 ? current : peak
  if (raw === null) return { value: '–', unit: '' }
  return { value: raw.toFixed(1), unit: peak !== null && raw === peak && (current === null || current < peak) ? 'peak' : '' }
}

export default function AirConditionsGrid({ snapshot, title }: AirConditionsGridProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]
  const heading = title ?? s.metricsTitle
  const uv = pickUvDisplay(snapshot)

  return (
    <section aria-label={heading} className="rounded-2xl border border-border bg-surface-raised p-4 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold">
          {heading}
        </h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        <AirCard
          label={s.realFeel}
          value={fmtTemp(snapshot?.feelsLikeC ?? null)}
          icon={<RealFeelIcon />}
          accent="amber"
        />
        <AirCard
          label={s.windSpeed}
          value={`${fmtWind(snapshot?.windKmh ?? snapshot?.windGustsKmh ?? null)}`}
          unit="km/h"
          icon={<WindIcon />}
          accent="sky"
        />
        <AirCard
          label={s.chanceOfRain}
          value={fmtPercent(snapshot?.chanceOfRainPct ?? null)}
          icon={<DropIcon />}
          accent="rose"
        />
        <AirCard
          label={s.uvIndex}
          value={uv.value}
          unit={uv.unit === 'peak' ? s.uvPeak : ''}
          icon={<UvIcon />}
          accent="emerald"
        />
      </div>
    </section>
  )
}

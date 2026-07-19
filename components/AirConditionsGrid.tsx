'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import { formatAge } from '@/lib/formatAge'
import type { CurrentSnapshot } from '@/lib/friendlyForecast'

interface AirConditionsGridProps {
  snapshot: CurrentSnapshot | null
  title?: string
  /** When true, the UV card shows the dedicated live label, otherwise it
   *  renders as a forecast-for-the-selected-hour. */
  isLiveNow?: boolean
  /** Value of the provider's `current=uv_index`. */
  liveUv?: number | null
  /** Timestamp for the live UV reading (ISO string from provider). */
  liveUvValidAt?: Date | null
  /** Forecast fetched-at timestamp (ms) for the auto-refresh banner. */
  fetchedAt?: number | null
  /** Forecast age (ms) — shown next to the metrics header. */
  forecastAgeMs?: number | null
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

function fmtMm(value: number | null): string {
  if (value === null) return '–'
  return `${value.toFixed(1)}`
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

function ToggleCard({
  label,
  value,
  unit,
  sub,
  icon,
  accent,
  onClick,
  extraTitle,
}: {
  label: string
  value: string
  unit?: string
  sub?: string
  icon: React.ReactNode
  accent: 'amber' | 'sky' | 'rose' | 'emerald'
  onClick: () => void
  extraTitle?: string
}) {
  const accentMap: Record<string, string> = {
    amber: 'text-amber-300 bg-amber-500/10',
    sky: 'text-sky-300 bg-sky-500/10',
    rose: 'text-rose-300 bg-rose-500/10',
    emerald: 'text-emerald-300 bg-emerald-500/10',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={extraTitle}
      className="rounded-2xl border border-border bg-surface-raised p-3 md:p-4 flex flex-col gap-1 min-w-0 text-left cursor-pointer transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
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
      {sub ? (
        <span className="text-[10px] text-text-muted tabular-nums">{sub}</span>
      ) : null}
    </button>
  )
}

export default function AirConditionsGrid({
  snapshot,
  title,
  isLiveNow = true,
  liveUv = null,
  liveUvValidAt = null,
  fetchedAt = null,
  forecastAgeMs = null,
}: AirConditionsGridProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]
  const heading = title ?? s.metricsTitle

  const [uvMode, setUvMode] = useState<'live' | 'peak'>('live')
  const [feelMode, setFeelMode] = useState<'feel' | 'high'>('feel')
  const [windMode, setWindMode] = useState<'wind' | 'gusts'>('wind')
  const [rainMode, setRainMode] = useState<'chance' | 'total'>('chance')

  // UV: in live mode prefer the provider's current=uv_index reading if we
  // still have it cached AND the user is on the actual current hour.
  // Outside of "live now" we fall back to the ensemble value because the
  // provider's current field is by definition "the present".
  const uvVal = uvMode === 'live'
    ? (isLiveNow ? (liveUv ?? snapshot?.uvIndex ?? null) : (snapshot?.uvIndex ?? null))
    : (snapshot?.uvIndexPeak ?? null)
  const uvDisplay = uvVal !== null ? uvVal.toFixed(1) : '–'
  const uvLabel = uvMode === 'live' ? s.uvModeLive : s.uvModePeak
  const uvUnit = uvMode === 'peak' ? s.uvPeak : ''
  // Age of the live UV reading. Open-Meteo reports ~15 min intervals.
  // `Date.now()` is impure so we track it through a state tick instead of
  // calling it during render.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const uvAgeMs = liveUvValidAt instanceof Date && !Number.isNaN(liveUvValidAt.getTime())
    ? nowMs - liveUvValidAt.getTime()
    : null
  const uvTitle = uvAgeMs !== null
    ? `${locale === 'en' ? 'Live UV, updated ' : 'UV en vivo, actualizado hace '}${formatAge(uvAgeMs, locale)}`
    : undefined
  const isStale = forecastAgeMs !== null && forecastAgeMs > 4 * 3600_000

  // Sensación / Máx
  const feelVal = feelMode === 'feel'
    ? (snapshot?.feelsLikeC ?? null)
    : (snapshot?.dailyHighC ?? null)
  const feelDisplay = fmtTemp(feelVal)
  const feelLabel = feelMode === 'feel' ? s.realFeel : s.dailyHigh

  // Viento / Rachas
  const windVal = windMode === 'wind'
    ? (snapshot?.windKmh ?? null)
    : (snapshot?.windGustsKmh ?? null)
  const windDisplay = fmtWind(windVal)
  const windLabel = windMode === 'wind' ? s.windSpeed : s.windGusts

  // Prob. lluvia / Lluvia total
  const rainVal = rainMode === 'chance'
    ? (snapshot?.chanceOfRainPct ?? null)
    : (snapshot?.precipitationMm ?? null)
  const rainDisplay = rainMode === 'chance' ? fmtPercent(rainVal) : fmtMm(rainVal)
  const rainUnit = rainMode === 'chance' ? '' : 'mm'
  const rainLabel = rainMode === 'chance' ? s.chanceOfRain : s.precipTotal

  return (
    <section aria-label={heading} className="rounded-2xl border border-border bg-surface-raised p-4 md:p-5">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold">
          {heading}
        </h3>
        {forecastAgeMs !== null ? (
          <span
            className={`text-[10px] tabular-nums ${isStale ? 'text-amber-400' : 'text-text-tertiary'}`}
            title={fetchedAt ? new Date(fetchedAt).toLocaleString() : ''}
            role={isStale ? 'status' : undefined}
            aria-live={isStale ? 'polite' : undefined}
          >
            {isStale
              ? (locale === 'en' ? `Refresh due · ${formatAge(forecastAgeMs, locale)}` : `Recarga pendiente · ${formatAge(forecastAgeMs, locale)}`)
              : (locale === 'en' ? `Updated ${formatAge(forecastAgeMs, locale)} ago` : `Actualizado hace ${formatAge(forecastAgeMs, locale)}`)}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        <ToggleCard
          label={feelLabel}
          value={feelDisplay}
          icon={<RealFeelIcon />}
          accent="amber"
          onClick={() => setFeelMode(m => m === 'feel' ? 'high' : 'feel')}
        />
        <ToggleCard
          label={windLabel}
          value={windDisplay}
          unit="km/h"
          icon={<WindIcon />}
          accent="sky"
          onClick={() => setWindMode(m => m === 'wind' ? 'gusts' : 'wind')}
        />
        <ToggleCard
          label={rainLabel}
          value={rainDisplay}
          unit={rainUnit}
          icon={<DropIcon />}
          accent="rose"
          onClick={() => setRainMode(m => m === 'chance' ? 'total' : 'chance')}
        />
        <ToggleCard
          // The mode label (Live/Peak) already tells the user which
          // view they're seeing, so the redundant "en vivo" badge was
          // producing "Índice UV · En vivo · en vivo". Live freshness is
          // still surfaced via the tooltip (`extraTitle`).
          label={`${s.uvIndex} · ${uvLabel}`}
          value={uvDisplay}
          unit={uvUnit}
          icon={<UvIcon />}
          accent="emerald"
          onClick={() => setUvMode(m => m === 'live' ? 'peak' : 'live')}
          extraTitle={uvTitle}
        />
      </div>
    </section>
  )
}

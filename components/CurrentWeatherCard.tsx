'use client'

import { useLocale } from '@/lib/LocaleContext'
import { CONDITION_LABEL } from '@/lib/i18n'
import type { WeatherIconId } from '@/lib/weatherIcon'
import type { CurrentSnapshot } from '@/lib/friendlyForecast'

interface CurrentWeatherCardProps {
  city: string
  snapshot: CurrentSnapshot | null
  loading?: boolean
}

function formatTemp(value: number | null): string {
  if (value === null) return '–'
  return `${Math.round(value)}°`
}

function formatPercent(value: number | null): string {
  if (value === null) return '–'
  return `${Math.round(value)}%`
}

const ICON_BG: Record<WeatherIconId, string> = {
  sunny: 'from-amber-400/30 to-orange-500/10',
  partly: 'from-amber-300/20 to-sky-400/10',
  cloudy: 'from-slate-400/20 to-slate-600/10',
  rainy: 'from-sky-500/25 to-blue-700/15',
  stormy: 'from-violet-500/25 to-slate-800/15',
  snowy: 'from-sky-200/25 to-slate-400/15',
}

export default function CurrentWeatherCard({ city, snapshot, loading }: CurrentWeatherCardProps) {
  const { locale } = useLocale()
  const iconId: WeatherIconId = snapshot ? snapshot.icon : 'sunny'
  const condition = snapshot ? CONDITION_LABEL[locale][snapshot.icon] : ''
  const showHighLow = snapshot && snapshot.dailyHighC !== null && snapshot.dailyLowC !== null

  return (
    <section
      aria-label={locale === 'en' ? 'Current weather' : 'Tiempo actual'}
      className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface-raised via-surface-raised to-surface-raised/60 p-5 md:p-7"
    >
      <div
        className={`pointer-events-none absolute -right-12 -top-12 h-56 w-56 rounded-full bg-gradient-to-br ${ICON_BG[iconId]} blur-3xl`}
        aria-hidden="true"
      />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-2xl md:text-3xl font-semibold text-text-primary tracking-tight">{city}</h2>
            {showHighLow && snapshot ? (
              <span className="text-sm text-text-secondary tabular-nums">
                {Math.round(snapshot.dailyHighC as number)}° / {Math.round(snapshot.dailyLowC as number)}°
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-text-secondary flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-text-primary">{condition}</span>
            {snapshot && snapshot.chanceOfRainPct !== null ? (
              <>
                <span className="text-text-muted" aria-hidden="true">·</span>
                <span>
                  {locale === 'en' ? 'Chance of rain:' : 'Probabilidad de lluvia:'}{' '}
                  <span className="text-text-primary font-medium">
                    {formatPercent(snapshot.chanceOfRainPct)}
                  </span>
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-end gap-3 md:gap-5">
          <div className="flex flex-col items-end">
            {loading ? (
              <div className="h-16 w-24 rounded bg-surface-popover animate-pulse" />
            ) : (
              <span className="text-6xl md:text-7xl font-extralight text-text-primary leading-none tabular-nums">
                {formatTemp(snapshot?.temperatureC ?? null)}
              </span>
            )}
            <span className="mt-1 text-[10px] uppercase tracking-widest text-text-muted">
              {snapshot ? new Date().toLocaleDateString(locale === 'en' ? 'en-US' : 'es-ES', { weekday: 'long' }) : ''}
            </span>
          </div>
          <BigWeatherIcon id={iconId} />
        </div>
      </div>
    </section>
  )
}

function BigWeatherIcon({ id }: { id: WeatherIconId }) {
  const cls = 'w-20 h-20 md:w-24 md:h-24'
  switch (id) {
    case 'sunny':
      return (
        <svg viewBox="0 0 64 64" className={cls + ' drop-shadow-[0_0_24px_rgba(251,191,36,0.45)]'} aria-hidden="true">
          <circle cx="32" cy="32" r="14" fill="#fcd34d" />
          <g stroke="#fbbf24" strokeWidth="3" strokeLinecap="round">
            <line x1="32" y1="6" x2="32" y2="14" />
            <line x1="32" y1="50" x2="32" y2="58" />
            <line x1="6" y1="32" x2="14" y2="32" />
            <line x1="50" y1="32" x2="58" y2="32" />
            <line x1="13" y1="13" x2="19" y2="19" />
            <line x1="45" y1="45" x2="51" y2="51" />
            <line x1="13" y1="51" x2="19" y2="45" />
            <line x1="45" y1="19" x2="51" y2="13" />
          </g>
        </svg>
      )
    case 'partly':
      return (
        <svg viewBox="0 0 64 64" className={cls + ' drop-shadow-[0_0_20px_rgba(251,191,36,0.35)]'} aria-hidden="true">
          <circle cx="22" cy="22" r="9" fill="#fcd34d" />
          <path d="M16 44a10 10 0 0 1 1-19.96A12 12 0 0 1 40 24a8 8 0 0 1 0 16H18a4 4 0 0 1-2-4z" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="2" />
        </svg>
      )
    case 'cloudy':
      return (
        <svg viewBox="0 0 64 64" className={cls} aria-hidden="true">
          <path d="M14 44a12 12 0 0 1 1.2-23.88A16 16 0 0 1 46 26a10 10 0 0 1 0 18z" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="2" />
        </svg>
      )
    case 'rainy':
      return (
        <svg viewBox="0 0 64 64" className={cls} aria-hidden="true">
          <path d="M14 36a12 12 0 0 1 1.2-23.88A16 16 0 0 1 46 18a10 10 0 0 1 0 18z" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="2" />
          <g stroke="#60a5fa" strokeWidth="3" strokeLinecap="round">
            <line x1="22" y1="46" x2="18" y2="56" />
            <line x1="32" y1="46" x2="28" y2="56" />
            <line x1="42" y1="46" x2="38" y2="56" />
          </g>
        </svg>
      )
    case 'stormy':
      return (
        <svg viewBox="0 0 64 64" className={cls} aria-hidden="true">
          <path d="M14 36a12 12 0 0 1 1.2-23.88A16 16 0 0 1 46 18a10 10 0 0 1 0 18z" fill="#94a3b8" stroke="#475569" strokeWidth="2" />
          <polygon points="30,38 22,52 30,52 26,60 38,44 30,44 34,38" fill="#facc15" stroke="#ca8a04" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )
    case 'snowy':
      return (
        <svg viewBox="0 0 64 64" className={cls} aria-hidden="true">
          <path d="M14 36a12 12 0 0 1 1.2-23.88A16 16 0 0 1 46 18a10 10 0 0 1 0 18z" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="2" />
          <g fill="#bae6fd" stroke="#0ea5e9" strokeWidth="1.5">
            <circle cx="24" cy="50" r="2" />
            <circle cx="34" cy="54" r="2" />
            <circle cx="42" cy="48" r="2" />
          </g>
        </svg>
      )
    default:
      return null
  }
}

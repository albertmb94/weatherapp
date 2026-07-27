'use client'

/**
 * F5: air-quality + pollen card.
 *
 * Visible on:
 *   - Desktop (>= 1024 px, all orientations)
 *   - Mobile landscape (any width, orientation=landscape, max height 540)
 *
 * Hidden on mobile portrait. The visibility is decided at the
 * parent (home-content) so this component can stay focused on
 * rendering. We accept a `visible: boolean` prop and bail early
 * with `return null` if it's false — the parent still controls
 * the network query lifecycle (so a hidden card doesn't keep
 * fetching data the user can't see).
 */
import { useMemo } from 'react'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import { AIR_METRICS } from '@/lib/models'
import {
  classifyEuropeanAqi,
  type AirQualityBand,
  type AirQualityResult,
} from '@/lib/airQuality'

interface AirQualityCardProps {
  data: AirQualityResult | null
  isLoading: boolean
  error?: string | null
}

const BAND_BG: Record<AirQualityBand, string> = {
  good: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200',
  fair: 'bg-lime-500/15 border-lime-500/40 text-lime-200',
  moderate: 'bg-amber-500/15 border-amber-500/40 text-amber-200',
  poor: 'bg-orange-500/15 border-orange-500/40 text-orange-200',
  very_poor: 'bg-rose-500/15 border-rose-500/40 text-rose-200',
  extreme: 'bg-red-700/30 border-red-700/60 text-red-100',
}

const BAND_TEXT: Record<AirQualityBand, string> = {
  good: 'text-emerald-300',
  fair: 'text-lime-300',
  moderate: 'text-amber-300',
  poor: 'text-orange-300',
  very_poor: 'text-rose-300',
  extreme: 'text-red-200',
}

function pickCurrentValue(
  series: AirQualityResult['series'],
  metricId: keyof AirQualityResult['series'],
): number | null {
  const arr = series?.[metricId]
  if (!arr || arr.length === 0) return null
  for (const v of arr) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

function formatValue(value: number | null, unit: string): string {
  if (value == null) return '–'
  // AQI is integer; µg/m³ gets one decimal; pollen as integer.
  if (unit === '') return Math.round(value).toString()
  if (unit === 'grains/m³') return Math.round(value).toString()
  return value.toFixed(1)
}

export default function AirQualityCard({
  data,
  isLoading,
  error,
}: AirQualityCardProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]

  // F5: i18n doesn't yet have air-quality keys, so we render
  // labels from the AIR_METRICS table (which is bilingual via
  // the parent's `STRINGS` map — see "table*" entries for the
  // pattern). We reuse the existing `table*` keys where they
  // exist, falling back to the metric label.
  const headlineAqi = useMemo(() => {
    if (!data) return null
    return pickCurrentValue(data.series, 'european_aqi')
  }, [data])

  const classification = useMemo(
    () => classifyEuropeanAqi(headlineAqi),
    [headlineAqi],
  )

  if (error) {
    return (
      <section
        aria-label={locale === 'en' ? 'Air quality' : 'Calidad del aire'}
        className="rounded-2xl border border-border bg-surface-raised p-4"
      >
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-semibold text-text-primary">
            {locale === 'en' ? 'Air quality' : 'Calidad del aire'}
          </h3>
        </div>
        <p className="text-xs text-text-tertiary">{error}</p>
      </section>
    )
  }

  return (
    <section
      aria-label={locale === 'en' ? 'Air quality' : 'Calidad del aire'}
      data-testid="air-quality-card"
      className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-text-primary">
          {locale === 'en' ? 'Air quality & pollen' : 'Calidad del aire y polen'}
        </h3>
        {classification && (
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${BAND_BG[classification.band]}`}
            title={classification.hint}
          >
            EU AQI {Math.round(headlineAqi ?? 0)} · {classification.label}
          </span>
        )}
      </div>

      <div
        className={`grid gap-2 ${
          // 4 cols on real-desktop, 3 on desktop compact,
          // 2 on mobile landscape. The card is not rendered
          // at all on mobile portrait, so we never have to
          // worry about 1-col layouts here.
          'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
        }`}
      >
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-lg border border-border bg-surface animate-pulse"
                aria-hidden="true"
              />
            ))
          : AIR_METRICS.map(m => {
              const v = data ? pickCurrentValue(data.series, m.id) : null
              return (
                <div
                  key={m.id}
                  className="rounded-lg border border-border bg-surface/40 p-2.5 flex flex-col gap-0.5 min-w-0"
                >
                  <span className="text-[10px] uppercase tracking-wide text-text-tertiary truncate">
                    {m.label}
                  </span>
                  <span
                    className={`text-lg font-semibold tabular-nums ${classification && m.id === 'european_aqi' ? BAND_TEXT[classification.band] : 'text-text-primary'}`}
                  >
                    {formatValue(v, m.unit)}
                    {v != null && m.unit && (
                      <span className="text-[10px] text-text-tertiary font-normal ml-1">
                        {m.unit}
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
      </div>
      {classification && (
        <p className="text-[10px] text-text-tertiary">{classification.hint}</p>
      )}
    </section>
  )
}

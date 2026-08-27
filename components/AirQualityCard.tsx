'use client'

/**
 * F5 (revised): air-quality + pollen card.
 *
 * Visible on:
 *   - Desktop (>= 1024 px, all orientations)
 *   - Mobile landscape (any width, orientation=landscape, max height 540)
 *
 * Hidden on mobile portrait. The visibility is decided at the
 * parent (home-content) so this component stays focused on
 * rendering. The parent still controls the network query
 * lifecycle (so a hidden card doesn't keep fetching data the
 * user can't see).
 *
 * Revised layout (2026-07-27):
 *   - The "EU AQI" headline badge that used to live in the
 *     header has been moved to the `AirConditionsGrid`
 *     (Métricas) section so every viewport — including mobile
 *     portrait — gets the headline air-quality reading. The
 *     card title here just labels the section and matches the
 *     Métricas title typography (`text-[11px] uppercase
 *     tracking-widest text-text-tertiary font-semibold`).
 *   - The full tile grid still surfaces pm2_5, pm10, ozone and
 *     the six pollen types so desktop users can drill in
 *     without leaving the page.
 */
import { useMemo } from 'react'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import { AIR_METRICS } from '@/lib/models'
import type { AirQualityResult } from '@/lib/airQuality'

interface AirQualityCardProps {
  data: AirQualityResult | null
  isLoading: boolean
  error?: string | null
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
  const title = s.airQualityTitle

  // F5 (revised): hide the headline EU AQI tile from the
  // tile grid — it now lives as a single chip in the
  // AirConditionsGrid (Métricas) so the desktop and mobile
  // experiences are consistent. The remaining tiles are
  // pollutants + pollen.
  const tiles = useMemo(
    () => AIR_METRICS.filter(m => m.id !== 'european_aqi'),
    [],
  )

  if (error) {
    return (
      <section
        aria-label={title}
        data-testid="air-quality-card"
        className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3"
      >
        <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold">
          {title}
        </h3>
        <p className="text-xs text-text-tertiary">{error}</p>
      </section>
    )
  }

  return (
    <section
      aria-label={title}
      data-testid="air-quality-card"
      className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3"
    >
      {/* Title style matches the Métricas section so the two
          blocks read as siblings. */}
      <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold">
        {title}
      </h3>

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
          : tiles.map(m => {
              const v = data ? pickCurrentValue(data.series, m.id) : null
              return (
                <div
                  key={m.id}
                  className="rounded-lg border border-border bg-surface/40 p-2.5 flex flex-col gap-0.5 min-w-0"
                >
                  <span className="text-[10px] uppercase tracking-wide text-text-tertiary truncate">
                    {m.label}
                  </span>
                  <span className="text-lg font-semibold tabular-nums text-text-primary">
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
    </section>
  )
}

'use client'

import { useMemo } from 'react'
import type { WeatherModel } from '@/lib/models'
import { ENSEMBLE_PRESETS, METRIC_TO_ENSEMBLE } from '@/lib/models'
import type { MetricId } from '@/lib/models'
import { pickWeatherIcon, type WeatherIconId } from '@/lib/weatherIcon'
import { ensembleWithFallback, resolveActiveModels, weightsForAbsolute } from '@/lib/ensemble/central'
import { useLocale } from '@/lib/LocaleContext'
import { DAY_NAMES, STRINGS } from '@/lib/i18n'
import WeatherConditionIcon from './WeatherConditionIcon'

const ICON_GRADIENTS: Record<WeatherIconId, string> = {
  sunny: 'from-amber-500/20 to-orange-600/10',
  partly: 'from-amber-400/15 to-sky-500/10',
  cloudy: 'from-gray-500/20 to-slate-600/10',
  rainy: 'from-sky-500/20 to-blue-700/10',
  stormy: 'from-violet-500/20 to-slate-800/10',
  snowy: 'from-sky-200/20 to-slate-400/10',
}

interface DailySummaryProps {
  models: WeatherModel[]
  activeModelIds: string[]
  times: Date[]
  series: Record<string, Record<string, (number | null)[]>>
  selectedHour: number
  onSelectHour: (hour: number) => void
  /** Optional day-filter callback. When provided, tapping a card
   *  fires this instead of `onSelectHour`. The parent uses it to
   *  slice the Insights table from the day's 00:00 without
   *  changing the URL hour (the user wants `onSelectHour`'s
   *  side-effects — slider/index changes — to be exclusive to
   *  row clicks). When omitted, the click falls back to
   *  `onSelectHour(noonIndex)` so existing tests/callers keep
   *  working. */
  onSelectDay?: (day: { startIndex: number; noonIndex: number; label: string }) => void
  /** When set, the matching card uses this as the active
   *  indicator instead of `selectedHour`. Lets the parent mark a
   *  card as "filtered" without writing back to the URL. */
  activeDayStartIndex?: number | null
  maxHours: number
  showMarine?: boolean
  showBasic?: boolean
  /** B-NEW-2: location's UTC offset so the "noon" card lands on the
   *  correct local hour. Required; pass 0 to fall back to UTC noon. */
  utcOffsetSeconds: number
  /** Index in `times` of the current hour — used to skip past days. */
  startIndex?: number
  /** B-NEW-10 (2026-07-25): ensemble mode. When `'wedai'`, the
   *  Resumen diario chips use the calibrated full land-model
   *  ensemble (all 19 non-marine models with preset weights),
   *  regardless of `activeModelIds`. When `'models'` (the default),
   *  they respect the user's selection. The previous behaviour
   *  was hardcoded to "respect the user's selection" which leaked
   *  into the friendly cards even after the user clicked WedAI. */
  ensembleMode?: 'wedai' | 'models'
}

interface DayBucket {
  label: string
  fullDate: string
  startIndex: number
  endIndex: number
  noonIndex: number
  tMin: number | null
  tMax: number | null
  precipTotal: number | null
  windMax: number | null
  cloudAvg: number | null
  waveHeightMax: number | null
  wavePeriodMean: number | null
  hasMarineData: boolean
  icon: WeatherIconId
}

// Robust accessor for series[modelId][metricId][i] that handles all the
// edge cases Open-Meteo can produce: missing models (key absent), missing
// metrics (value undefined or literal null), or out-of-range indexes.
function getMetric(
  series: Record<string, Record<string, (number | null)[] | null | undefined>>,
  modelId: string,
  metricId: string,
  index: number
): number | null {
  const m = series?.[modelId]
  const arr = m?.[metricId]
  if (arr === null || arr === undefined) return null
  const v = arr[index]
  return v === undefined || v === null ? null : v
}

export default function DailySummary({
  models,
  activeModelIds,
  times,
  series,
  selectedHour,
  onSelectHour,
  onSelectDay,
  activeDayStartIndex = null,
  maxHours,
  showMarine = false,
  showBasic = true,
  utcOffsetSeconds = 0,
  startIndex = 0,
  ensembleMode = 'models',
}: DailySummaryProps) {
  const { locale } = useLocale()

  // B-NEW-10 (2026-07-25): when the Avanzado toggle is on WedAI,
  // resolve the active set via `resolveActiveModels(_, _, 'wedai')`
  // so the chip temperature comes from every land model, not the
  // user's last selection. When the toggle is on Models, keep the
  // previous "respect the user's selection" behaviour.
  const activeModels = useMemo(
    () => resolveActiveModels(models, activeModelIds, ensembleMode),
    [models, activeModelIds, ensembleMode]
  )

  const days = useMemo<DayBucket[]>(() => {
    if (activeModels.length === 0 || times.length === 0) return []
    const modelIds = activeModels.map(m => m.id)

    // Build per-metric, per-hour weight arrays using ensemble presets.
    // Use the canonical helper so InsightsTable, DailySummary and the
    // comparison chart always classify horizons identically.
    const getWeightsForMetricAndHour = (metric: MetricId, hourIndex: number): number[] =>
      weightsForAbsolute(metric, hourIndex, 1, activeModels)

    const limit = Math.min(times.length, maxHours)
    const buckets: DayBucket[] = []
    let current: DayBucket | null = null

    for (let i = startIndex; i < limit; i++) {
      const t = times[i]
      if (!(t instanceof Date)) continue
      const dayKey = `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`
      if (!current || current.fullDate !== dayKey) {
        // Scan backwards to find 00:00 of this day so the first bucket
        // captures temperatures from midnight, not just from startIndex.
        let dayStart = i
        while (dayStart > 0) {
          const prev = times[dayStart - 1]
          if (!(prev instanceof Date)) break
          const prevKey = `${prev.getUTCFullYear()}-${prev.getUTCMonth()}-${prev.getUTCDate()}`
          if (prevKey !== dayKey) break
          dayStart--
        }
        current = {
          label: `${DAY_NAMES[locale][t.getUTCDay()]} ${t.getUTCDate()}`,
          fullDate: dayKey,
          startIndex: dayStart,
          endIndex: i,
          noonIndex: i,
          tMin: null,
          tMax: null,
          precipTotal: null,
          windMax: null,
          cloudAvg: null,
          waveHeightMax: null,
          wavePeriodMean: null,
          hasMarineData: false,
          icon: 'sunny',
        }
        buckets.push(current)
      }
      current.endIndex = i
      // Times are stored as "UTC-fake-local" (see lib/dateUtils.ts):
      // getUTCHours() === 12 already means 12:00 at the LOCATION, so we
      // must NOT subtract the offset again — the previous code applied it
      // twice and selected 10:00 for CEST cities.
      if (t.getUTCHours() === 12) current.noonIndex = i
    }

    // B-NEW-7 (2026-07-24): `wedaiModels` is the full land-model
    // set (all non-marine) used as the WedAI fallback when the
    // user's selection returns null for a given hour. After the
    // long-range model filter (B-NEW-3) the production API only
    // returns 5 long-range models, so a user who has selected
    // only a short-range model like `meteofrance_arome_france_hd`
    // would otherwise see every DailySummary chip render "–°"
    // for the 14-day summary because the selected model has no
    // entry in the series. The fallback re-runs the mean against
    // `wedaiModels` so the user always sees a value when at least
    // one model has data. This is the same fallback the
    // InsightsTable now uses via `ensembleWithFallback`.
    const wedaiModels = models.filter(m => m.id !== 'marine_global')

    for (const bucket of buckets) {
      let cloudSum = 0
      let cloudCount = 0
      let waveSum = 0
      let waveCount = 0
      for (let i = bucket.startIndex; i <= bucket.endIndex; i++) {
        const tWeights = getWeightsForMetricAndHour('temperature', i)
        const t = ensembleWithFallback(series, 'temperature', i, activeModels, wedaiModels, tWeights)
        if (t !== null) {
          if (bucket.tMin === null || t < bucket.tMin) bucket.tMin = t
          if (bucket.tMax === null || t > bucket.tMax) bucket.tMax = t
        }
        const pWeights = getWeightsForMetricAndHour('precipitation', i)
        const p = ensembleWithFallback(series, 'precipitation', i, activeModels, wedaiModels, pWeights)
        if (p !== null) bucket.precipTotal = (bucket.precipTotal ?? 0) + p
        const wWeights = getWeightsForMetricAndHour('wind_gusts', i)
        const w = ensembleWithFallback(series, 'wind_gusts', i, activeModels, wedaiModels, wWeights)
        if (w !== null && (bucket.windMax === null || w > bucket.windMax)) bucket.windMax = w
        const cWeights = getWeightsForMetricAndHour('cloud_cover', i)
        const c = ensembleWithFallback(series, 'cloud_cover', i, activeModels, wedaiModels, cWeights)
        if (c !== null) {
          cloudSum += c
          cloudCount += 1
        }
        const wh = getMetric(series, 'marine_global', 'wave_height', i)
        const wp = getMetric(series, 'marine_global', 'wave_period', i)
        if (wh !== null && wh !== undefined) {
          bucket.waveHeightMax = bucket.waveHeightMax === null ? wh : Math.max(bucket.waveHeightMax, wh)
          bucket.hasMarineData = true
        }
        if (wp !== null && wp !== undefined) {
          waveSum += wp
          waveCount += 1
        }
      }
      bucket.cloudAvg = cloudCount > 0 ? cloudSum / cloudCount : null
      bucket.wavePeriodMean = waveCount > 0 ? waveSum / waveCount : null
      bucket.icon = pickWeatherIcon({
        cloudCoverPct: bucket.cloudAvg,
        precipitationMmDay: bucket.precipTotal,
        windGustsKmh: bucket.windMax,
        minTempC: bucket.tMin,
      })
    }

    return buckets
  }, [activeModels, times, series, maxHours, startIndex, locale, utcOffsetSeconds])

  if (days.length === 0) return null

  // Always 7 columns max so cards never shrink below the 7-days size.
  // When there are more than 7 days, the grid overflows horizontally
  // and the user scrolls; on sm+ the grid switches to the natural
  // auto-fit layout that wraps to multiple rows.
  const cols = Math.min(days.length, 7)

  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-text-primary mb-2">{STRINGS[locale].dailyTitle}</h3>
      <div
        className="grid gap-1 overflow-x-auto scrollbar-none"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {days.map((d, i) => {
          // The active state comes from two sources, in priority order:
          //   1. `activeDayStartIndex` is set by the parent when the
          //      user has filtered the Insights table to a single day.
          //      We honor it so the active highlight follows the
          //      filter, not the URL hour (which the filter does not
          //      change).
          //   2. Otherwise the card is "active" when the URL hour
          //      falls inside the day's range — the legacy behaviour.
          const isCurrent = activeDayStartIndex !== null
            ? activeDayStartIndex === d.startIndex
            : selectedHour >= d.startIndex && selectedHour <= d.endIndex
          const handleClick = () => {
            if (onSelectDay) {
              onSelectDay({ startIndex: d.startIndex, noonIndex: d.noonIndex, label: d.label })
            } else {
              onSelectHour(d.noonIndex)
            }
          }
          return (
            <button
              key={i}
              type="button"
              onClick={handleClick}
              data-testid="daily-card"
              data-day-start={d.startIndex}
              aria-pressed={isCurrent}
              aria-label={(onSelectDay
                ? (locale === 'en' ? `Filter Insights to ${d.label}.` : `Filtrar Insights desde ${d.label}.`)
                : (locale === 'en' ? `Jump to ${d.label} at 12:00.` : `Ir a ${d.label} a las 12:00.`))}
              className={`min-w-0 px-1.5 py-1.5 rounded border text-center transition-all cursor-pointer bg-gradient-to-br ${ICON_GRADIENTS[d.icon]} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                isCurrent ? 'border-accent shadow-[0_0_8px_var(--accent-soft)]' : 'border-border hover:border-border-strong'
              }`}
              title={onSelectDay
                ? (locale === 'en' ? `Filter Insights from ${d.label} (00:00)` : `Filtrar Insights desde ${d.label} (00:00)`)
                : `Jump to ${d.label} at 12:00`}
            >
              <div className="text-[11px] font-semibold text-text-primary truncate">{d.label}</div>
              <div className="flex justify-center my-0.5"><WeatherConditionIcon icon={d.icon} /></div>
              <div className="flex items-baseline justify-center gap-0.5 leading-none">
                <span className="text-[11px] font-bold text-text-primary">{d.tMax !== null ? Math.round(d.tMax) : '–'}°</span>
                <span className="text-[10px] text-text-tertiary">{d.tMin !== null ? Math.round(d.tMin) : '–'}°</span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-center gap-0.5 text-[9px] text-text-tertiary leading-none tabular-nums">
                <span title="Precipitation total">{d.precipTotal !== null ? d.precipTotal.toFixed(1) : '–'}</span>
                <span className="text-text-muted">·</span>
                <span title="Max wind gusts">{d.windMax !== null ? Math.round(d.windMax) : '–'}</span>
              </div>
              {showMarine && d.hasMarineData && (
                <div className="mt-0.5 flex items-center justify-center text-[9px] text-cyan-300 leading-none tabular-nums" title="Max wave height / mean wave period">
                  {d.waveHeightMax !== null ? d.waveHeightMax.toFixed(1) : '–'}
                  {d.wavePeriodMean !== null && <span className="ml-0.5 text-text-tertiary">/{Math.round(d.wavePeriodMean)}s</span>}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

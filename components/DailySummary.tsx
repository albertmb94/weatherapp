'use client'

import { useMemo } from 'react'
import type { WeatherModel } from '@/lib/models'
import { pickWeatherIcon, type WeatherIconId } from '@/lib/weatherIcon'
import { weightedAvg } from '@/lib/ensemble'
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
  maxHours: number
  showMarine?: boolean
  showBasic?: boolean
  /** B-NEW-2: location's UTC offset so the "noon" card lands on the
   *  correct local hour. Required; pass 0 to fall back to UTC noon. */
  utcOffsetSeconds: number
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
  maxHours,
  showMarine = false,
  showBasic = true,
  utcOffsetSeconds = 0,
}: DailySummaryProps) {
  const { locale } = useLocale()

  const activeModels = useMemo(
    () => models.filter(m => activeModelIds.includes(m.id)),
    [models, activeModelIds]
  )

  const days = useMemo<DayBucket[]>(() => {
    if (activeModels.length === 0 || times.length === 0) return []
    const weights = activeModels.map(m => m.weight)
    const limit = Math.min(times.length, maxHours)
    const buckets: DayBucket[] = []
    let current: DayBucket | null = null
    // B-NEW-2: noonIndex must be the location's local noon, not 12:00 UTC.
    // For a CEST (UTC+2) city local noon = 10:00 UTC; for a UTC-5 city it
    // = 17:00 UTC. The shift wraps around midnight cleanly.
    const localNoonUtcHour = ((12 - Math.round(utcOffsetSeconds / 3600)) % 24 + 24) % 24

    for (let i = 0; i < limit; i++) {
      const t = times[i]
      if (!(t instanceof Date)) continue
      const dayKey = `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`
      if (!current || current.fullDate !== dayKey) {
        current = {
          label: `${DAY_NAMES[locale][t.getUTCDay()]} ${t.getUTCDate()}`,
          fullDate: dayKey,
          startIndex: i,
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
      if (t.getUTCHours() === localNoonUtcHour) current.noonIndex = i
    }

    for (const bucket of buckets) {
      let cloudSum = 0
      let cloudCount = 0
      let waveSum = 0
      let waveCount = 0
      for (let i = bucket.startIndex; i <= bucket.endIndex; i++) {
        const tVals = activeModels.map(m => getMetric(series, m.id, 'temperature', i))
        const t = weightedAvg(tVals, weights)
        if (t !== null) {
          if (bucket.tMin === null || t < bucket.tMin) bucket.tMin = t
          if (bucket.tMax === null || t > bucket.tMax) bucket.tMax = t
        }
        const pVals = activeModels.map(m => getMetric(series, m.id, 'precipitation', i))
        const p = weightedAvg(pVals, weights)
        if (p !== null) bucket.precipTotal = (bucket.precipTotal ?? 0) + p
        const wVals = activeModels.map(m => getMetric(series, m.id, 'wind_gusts', i))
        const w = weightedAvg(wVals, weights)
        if (w !== null && (bucket.windMax === null || w > bucket.windMax)) bucket.windMax = w
        const cVals = activeModels.map(m => getMetric(series, m.id, 'cloud_cover', i))
        const c = weightedAvg(cVals, weights)
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
  }, [activeModels, times, series, maxHours, locale, utcOffsetSeconds])

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
          const isCurrent = selectedHour >= d.startIndex && selectedHour <= d.endIndex
          return (
            <button
              key={i}
              onClick={() => onSelectHour(d.noonIndex)}
              className={`min-w-0 px-1.5 py-1.5 rounded border text-center transition-all cursor-pointer bg-gradient-to-br ${ICON_GRADIENTS[d.icon]} ${
                isCurrent ? 'border-accent shadow-[0_0_8px_var(--accent-soft)]' : 'border-border hover:border-border-strong'
              }`}
              title={`Jump to ${d.label} at 12:00`}
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

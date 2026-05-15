'use client'

import { useMemo } from 'react'
import type { WeatherModel } from '@/lib/models'
import { pickWeatherIcon, type WeatherIconId } from '@/lib/weatherIcon'

interface DailySummaryProps {
  models: WeatherModel[]
  activeModelIds: string[]
  times: Date[]
  series: Record<string, Record<string, (number | null)[]>>
  selectedHour: number
  onSelectHour: (hour: number) => void
  maxHours: number
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
  icon: WeatherIconId
}

const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function weightedAvg(values: (number | null)[], weights: number[]): number | null {
  let sum = 0
  let wSum = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v !== null && v !== undefined) {
      sum += v * weights[i]
      wSum += weights[i]
    }
  }
  return wSum > 0 ? sum / wSum : null
}

const ICONS: Record<WeatherIconId, React.ReactNode> = {
  sunny: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-7 h-7 text-amber-400">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </svg>
  ),
  partly: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" className="w-7 h-7 text-amber-300">
      <circle cx="9" cy="9" r="3" fill="currentColor" />
      <path d="M9 3v1.5M9 13.5V15M3 9h1.5M13.5 9H15M5 5l1 1M12 12l1 1M5 13l1-1M12 6l1-1" stroke="currentColor" strokeOpacity={0.7} />
      <path d="M9 17a3 3 0 0 1 .3-5.97A4 4 0 0 1 17 11.5a2.5 2.5 0 0 1 0 5z" fill="#9ca3af" stroke="#6b7280" />
    </svg>
  ),
  cloudy: (
    <svg viewBox="0 0 24 24" fill="#9ca3af" stroke="#6b7280" strokeWidth={1.5} strokeLinejoin="round" className="w-7 h-7">
      <path d="M6 16a4 4 0 0 1 .4-7.96A5 5 0 0 1 16 8.5a3 3 0 0 1 0 6z" />
    </svg>
  ),
  rainy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="w-7 h-7 text-sky-400">
      <path d="M6 13a4 4 0 0 1 .4-7.96A5 5 0 0 1 16 5.5a3 3 0 0 1 0 6z" fill="#9ca3af" stroke="#6b7280" />
      <path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" />
    </svg>
  ),
  stormy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="w-7 h-7 text-yellow-300">
      <path d="M6 13a4 4 0 0 1 .4-7.96A5 5 0 0 1 16 5.5a3 3 0 0 1 0 6z" fill="#6b7280" stroke="#4b5563" />
      <path d="M12 13l-2 5h3l-2 4" fill="currentColor" />
    </svg>
  ),
  snowy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="w-7 h-7 text-sky-200">
      <path d="M6 13a4 4 0 0 1 .4-7.96A5 5 0 0 1 16 5.5a3 3 0 0 1 0 6z" fill="#cbd5e1" stroke="#94a3b8" />
      <path d="M9 17l1 3M13 17l1 3M11 18h2M9 19l2-1M13 19l-2-1" />
    </svg>
  ),
}

export default function DailySummary({
  models,
  activeModelIds,
  times,
  series,
  selectedHour,
  onSelectHour,
  maxHours,
}: DailySummaryProps) {
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

    for (let i = 0; i < limit; i++) {
      const t = times[i]
      const dayKey = `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`
      if (!current || current.fullDate !== dayKey) {
        current = {
          label: `${DAYS_ES[t.getDay()]} ${t.getDate()}`,
          fullDate: dayKey,
          startIndex: i,
          endIndex: i,
          noonIndex: i,
          tMin: null,
          tMax: null,
          precipTotal: null,
          windMax: null,
          cloudAvg: null,
          icon: 'sunny',
        }
        buckets.push(current)
      }
      current.endIndex = i
      if (t.getHours() === 12) current.noonIndex = i
    }

    for (const bucket of buckets) {
      let cloudSum = 0
      let cloudCount = 0
      for (let i = bucket.startIndex; i <= bucket.endIndex; i++) {
        const tVals = activeModels.map(m => series[m.id]?.['temperature']?.[i] ?? null)
        const t = weightedAvg(tVals, weights)
        if (t !== null) {
          if (bucket.tMin === null || t < bucket.tMin) bucket.tMin = t
          if (bucket.tMax === null || t > bucket.tMax) bucket.tMax = t
        }
        const pVals = activeModels.map(m => series[m.id]?.['precipitation']?.[i] ?? null)
        const p = weightedAvg(pVals, weights)
        if (p !== null) bucket.precipTotal = (bucket.precipTotal ?? 0) + p
        const wVals = activeModels.map(m => series[m.id]?.['wind_gusts']?.[i] ?? null)
        const w = weightedAvg(wVals, weights)
        if (w !== null && (bucket.windMax === null || w > bucket.windMax)) bucket.windMax = w
        const cVals = activeModels.map(m => series[m.id]?.['cloud_cover']?.[i] ?? null)
        const c = weightedAvg(cVals, weights)
        if (c !== null) {
          cloudSum += c
          cloudCount += 1
        }
      }
      bucket.cloudAvg = cloudCount > 0 ? cloudSum / cloudCount : null
      bucket.icon = pickWeatherIcon({
        cloudCoverPct: bucket.cloudAvg,
        precipitationMmDay: bucket.precipTotal,
        windGustsKmh: bucket.windMax,
        minTempC: bucket.tMin,
      })
    }

    return buckets
  }, [activeModels, times, series, maxHours])

  if (days.length === 0) return null

  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-gray-300 mb-2">Daily summary (ensemble)</h3>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {days.map((d, i) => {
          const isCurrent = selectedHour >= d.startIndex && selectedHour <= d.endIndex
          return (
            <button
              key={i}
              onClick={() => onSelectHour(d.noonIndex)}
              className={`shrink-0 w-24 px-2 py-2 rounded border text-left transition-colors cursor-pointer ${
                isCurrent ? 'bg-gray-800 border-blue-600' : 'bg-gray-900/60 border-gray-800 hover:border-gray-700'
              }`}
              title={`Jump to ${d.label} at 12:00`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-gray-300">{d.label}</span>
                {ICONS[d.icon]}
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-sm font-bold text-white">{d.tMax !== null ? Math.round(d.tMax) : '–'}°</span>
                <span className="text-[10px] text-gray-500">{d.tMin !== null ? Math.round(d.tMin) : '–'}°</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-500">
                <span title="Precipitation total">💧 {d.precipTotal !== null ? d.precipTotal.toFixed(1) : '–'}</span>
                <span title="Max wind gusts">≋ {d.windMax !== null ? Math.round(d.windMax) : '–'}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

'use client'

import { useMemo } from 'react'
import type { WeatherModel } from '@/lib/models'
import { getColor } from '@/lib/colorScales'
import { weightedAvg, contrastText } from '@/lib/ensemble'
import { pickWeatherIcon, type WeatherIconId } from '@/lib/weatherIcon'
import { useLocale } from '@/lib/LocaleContext'
import { DAY_NAMES, STRINGS } from '@/lib/i18n'

export type BucketHours = 1 | 2 | 3 | 4 | 6 | 12 | 24

interface InsightsTableProps {
  models: WeatherModel[]
  activeModelIds: string[]
  times: Date[]
  series: Record<string, Record<string, (number | null)[]>>
  bucket: BucketHours
  onBucketChange: (b: BucketHours) => void
  selectedHour: number
  onSelectHour: (h: number) => void
  maxHours: number
}

interface Row {
  label: string
  startIdx: number
  endIdx: number
  centerIdx: number
  tempMean: number | null
  tempMin: number | null
  tempMax: number | null
  cloudMean: number | null
  windMean: number | null
  windDirection: number | null
  gustsMax: number | null
  precipSum: number | null
  humidityMean: number | null
  uvIndexMean: number | null
  icon: WeatherIconId
}
const BUCKET_OPTIONS: BucketHours[] = [1, 2, 3, 4, 6, 12, 24]
const BUCKET_LABELS: Record<BucketHours, string> = {
  1: '1h', 2: '2h', 3: '3h', 4: '4h', 6: '6h', 12: '12h', 24: '1d',
}



function tempEmoji(t: number | null): string {
  if (t === null) return ''
  if (t <= 0) return '🥶'
  if (t >= 30) return '🥵'
  return ''
}

function WindArrow({ degrees }: { degrees: number | null }) {
  if (degrees === null) return null
  // wind_direction is where wind comes FROM. Rotate +180° so the arrow
  // points where the wind is GOING.
  const rot = (degrees + 180) % 360
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-3 h-3 inline-block"
      style={{ transform: `rotate(${rot}deg)` }}
      aria-hidden
    >
      <path d="M8 1.5 L4 8 L7 8 L7 14.5 L9 14.5 L9 8 L12 8 Z" fill="currentColor" />
    </svg>
  )
}



function bucketLabel(start: Date, bucket: BucketHours, locale: 'es' | 'en'): string {
  const today = new Date()
  const isToday = start.getFullYear() === today.getFullYear() && start.getMonth() === today.getMonth() && start.getDate() === today.getDate()
  const isTomorrow = (() => {
    const t = new Date(today)
    t.setDate(t.getDate() + 1)
    return start.getFullYear() === t.getFullYear() && start.getMonth() === t.getMonth() && start.getDate() === t.getDate()
  })()
  const s = STRINGS[locale]
  const day = isToday ? s.today : isTomorrow ? s.tomorrow : `${DAY_NAMES[locale][start.getDay()]} ${start.getDate()}`
  if (bucket === 24) return day
  const h0 = start.getHours().toString().padStart(2, '0')
  if (bucket === 1) return `${day} ${h0}:00`
  const h1 = ((start.getHours() + bucket) % 24).toString().padStart(2, '0')
  return `${day} ${h0}–${h1}`
}

export default function InsightsTable({
  models,
  activeModelIds,
  times,
  series,
  bucket,
  onBucketChange,
  selectedHour,
  onSelectHour,
  maxHours,
}: InsightsTableProps) {
  const { locale } = useLocale()
  const activeModels = useMemo(
    () => models.filter(m => activeModelIds.includes(m.id)),
    [models, activeModelIds]
  )

  const rows = useMemo<Row[]>(() => {
    if (activeModels.length === 0 || times.length === 0) return []
    const weights = activeModels.map(m => m.weight)
    const limit = Math.min(times.length, maxHours)
    const buckets: Row[] = []
    let cursor = 0

    if (bucket === 24) {
      let current: Row | null = null
      let currentKey = ''
      for (let i = 0; i < limit; i++) {
        const t = times[i]
        const key = `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`
        if (!current || key !== currentKey) {
          current = {
            label: bucketLabel(t, bucket, locale),
            startIdx: i,
            endIdx: i,
            centerIdx: i,
            tempMean: null, tempMin: null, tempMax: null,
            cloudMean: null, windMean: null, windDirection: null, gustsMax: null, precipSum: null,
            humidityMean: null, uvIndexMean: null,
            icon: 'sunny',
          }
          currentKey = key
          buckets.push(current)
        }
        current.endIdx = i
        if (t.getHours() === 12) current.centerIdx = i
      }
    } else {
      while (cursor < limit) {
        const startT = times[cursor]
        if (!startT) break
        const startHour = startT.getHours()
        const alignedStart = startHour - (startHour % bucket)
        const startInBucket = startHour - alignedStart
        const remaining = bucket - startInBucket
        const end = Math.min(cursor + remaining, limit) - 1
        if (end < cursor) break
        buckets.push({
          label: bucketLabel(new Date(startT.getTime() - startInBucket * 3600_000), bucket, locale),
          startIdx: cursor,
          endIdx: end,
          centerIdx: cursor + Math.floor((end - cursor) / 2),
          tempMean: null, tempMin: null, tempMax: null,
          cloudMean: null, windMean: null, windDirection: null, gustsMax: null, precipSum: null,
          humidityMean: null, uvIndexMean: null,
          icon: 'sunny',
        })
        cursor = end + 1
      }
    }

    for (const b of buckets) {
      let tSum = 0, tCount = 0
      let cSum = 0, cCount = 0
      let wSum = 0, wCount = 0
      let hSum = 0, hCount = 0
      let uSum = 0, uCount = 0
      let dirCos = 0, dirSin = 0, dirCount = 0
      for (let i = b.startIdx; i <= b.endIdx; i++) {
        const tVals = activeModels.map(m => series[m.id]?.['temperature']?.[i] ?? null)
        const tEns = weightedAvg(tVals, weights)
        if (tEns !== null) {
          tSum += tEns
          tCount += 1
          if (b.tempMin === null || tEns < b.tempMin) b.tempMin = tEns
          if (b.tempMax === null || tEns > b.tempMax) b.tempMax = tEns
        }
        const cVals = activeModels.map(m => series[m.id]?.['cloud_cover']?.[i] ?? null)
        const cEns = weightedAvg(cVals, weights)
        if (cEns !== null) { cSum += cEns; cCount += 1 }
        const wVals = activeModels.map(m => series[m.id]?.['wind_speed']?.[i] ?? null)
        const wEns = weightedAvg(wVals, weights)
        if (wEns !== null) { wSum += wEns; wCount += 1 }
        const gVals = activeModels.map(m => series[m.id]?.['wind_gusts']?.[i] ?? null)
        const gEns = weightedAvg(gVals, weights)
        if (gEns !== null && (b.gustsMax === null || gEns > b.gustsMax)) b.gustsMax = gEns
        const pVals = activeModels.map(m => series[m.id]?.['precipitation']?.[i] ?? null)
        const pEns = weightedAvg(pVals, weights)
        if (pEns !== null) b.precipSum = (b.precipSum ?? 0) + pEns
        const hVals = activeModels.map(m => series[m.id]?.['humidity']?.[i] ?? null)
        const hEns = weightedAvg(hVals, weights)
        if (hEns !== null) { hSum += hEns; hCount += 1 }
        const uVals = activeModels.map(m => series[m.id]?.['uv_index']?.[i] ?? null)
        const uEns = weightedAvg(uVals, weights)
        if (uEns !== null) { uSum += uEns; uCount += 1 }
        // Circular mean of wind direction: average sin/cos across models,
        // weighted by model weight, then accumulate per hour.
        let hCos = 0, hSin = 0, hW = 0
        for (let j = 0; j < activeModels.length; j++) {
          const d = series[activeModels[j].id]?.['wind_direction']?.[i]
          if (d === null || d === undefined) continue
          const rad = (d * Math.PI) / 180
          hCos += Math.cos(rad) * weights[j]
          hSin += Math.sin(rad) * weights[j]
          hW += weights[j]
        }
        if (hW > 0) {
          dirCos += hCos / hW
          dirSin += hSin / hW
          dirCount += 1
        }
      }
      b.tempMean = tCount > 0 ? tSum / tCount : null
      b.cloudMean = cCount > 0 ? cSum / cCount : null
      b.windMean = wCount > 0 ? wSum / wCount : null
      b.humidityMean = hCount > 0 ? hSum / hCount : null
      b.uvIndexMean = uCount > 0 ? uSum / uCount : null
      b.windDirection = dirCount > 0
        ? ((Math.atan2(dirSin, dirCos) * 180) / Math.PI + 360) % 360
        : null
      b.icon = pickWeatherIcon({
        cloudCoverPct: b.cloudMean,
        precipitationMmDay: b.precipSum,
        windGustsKmh: b.gustsMax,
        minTempC: b.tempMin,
      })
    }

    return buckets
  }, [activeModels, times, series, bucket, maxHours, locale])

  if (activeModels.length === 0) return null

  return (
    <div className="mb-4 animate-fadeIn">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-300">{STRINGS[locale].insightsTitle}</h3>
        <div className="flex items-center gap-0.5 bg-gray-900/60 border border-gray-800 rounded p-0.5">
          {BUCKET_OPTIONS.map(b => (
            <button
              key={b}
              onClick={() => onBucketChange(b)}
              className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors min-h-[28px] ${
                bucket === b ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {BUCKET_LABELS[b]}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-gray-800">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-gray-900 text-gray-400">
              <th className="sticky left-0 bg-gray-900 text-left px-2 py-1.5 font-medium z-10 border-b border-gray-800 min-w-[80px]">{STRINGS[locale].tableWhen}</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800">{STRINGS[locale].tableCond}</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800">{STRINGS[locale].tableTemp}</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800 hidden md:table-cell">{STRINGS[locale].tableMin}</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800 hidden md:table-cell">{STRINGS[locale].tableMax}</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800 hidden md:table-cell">{STRINGS[locale].tableClouds}</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800">{STRINGS[locale].tableWind}</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800 hidden md:table-cell">{STRINGS[locale].tableGusts}</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800">{STRINGS[locale].tablePrecip}</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800">{STRINGS[locale].tableHumidity}</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800">{STRINGS[locale].tableUv}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isActive = selectedHour >= r.startIdx && selectedHour <= r.endIdx
              return (
                <tr
                  key={i}
                  onClick={() => onSelectHour(r.centerIdx)}
                  className={`cursor-pointer transition-colors ${isActive ? 'bg-blue-900/30' : 'hover:bg-gray-800/40'}`}
                >
                  <td className={`sticky left-0 px-2 py-1.5 whitespace-nowrap text-gray-300 border-b border-gray-800/60 ${isActive ? 'bg-blue-900/30' : 'bg-gray-950'}`}>
                    {r.label}
                  </td>
                  <td className="text-center px-2 py-1.5 border-b border-gray-800/60 text-xs leading-none text-gray-500" title={r.icon}>
                    –
                  </td>
                  <Cell value={r.tempMean} metric="temperature" suffix="°" />
                  <Cell value={r.tempMin} metric="temperature" suffix="°" emoji={tempEmoji(r.tempMin)} hideOnMobile="md" />
                  <Cell value={r.tempMax} metric="temperature" suffix="°" emoji={tempEmoji(r.tempMax)} hideOnMobile="md" />
                  <Cell value={r.cloudMean} metric="cloud_cover" suffix="%" hideOnMobile="md" />
                  <Cell value={r.windMean} metric="wind_speed" icon={<WindArrow degrees={r.windDirection} />} tooltip={r.windDirection !== null ? `${Math.round(r.windDirection)}°` : undefined} />
                  <Cell value={r.gustsMax} metric="wind_gusts" icon={<WindArrow degrees={r.windDirection} />} hideOnMobile="md" tooltip={r.windDirection !== null ? `${Math.round(r.windDirection)}°` : undefined} />
                  <Cell value={r.precipSum} metric="precipitation" decimals={1} />
                  <Cell value={r.humidityMean} metric="humidity" suffix="%" />
                  <Cell value={r.uvIndexMean} metric="uv_index" decimals={1} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface CellProps {
  value: number | null
  metric: 'temperature' | 'cloud_cover' | 'wind_speed' | 'wind_gusts' | 'precipitation' | 'humidity' | 'uv_index'
  suffix?: string
  emoji?: string
  icon?: React.ReactNode
  decimals?: number
  tooltip?: string
  hideOnMobile?: 'sm' | 'md'
}

function Cell({ value, metric, suffix = '', emoji = '', icon, decimals = 0, tooltip, hideOnMobile }: CellProps) {
  const bg = getColor(metric, value)
  const text = value !== null ? contrastText(bg) : '#888'
  const display = value !== null
    ? (decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString())
    : '–'
  const hideClass = hideOnMobile ? `hidden ${hideOnMobile === 'md' ? 'md:table-cell' : 'sm:table-cell'}` : ''
  return (
    <td
      className={`text-center px-2 py-1.5 border-b border-gray-800/60 font-mono ${hideClass}`}
      style={{ backgroundColor: bg, color: text }}
      title={tooltip}
    >
      <span className="inline-flex items-center gap-1 justify-center">
        {icon ? icon : emoji && <span aria-hidden className="text-xs">{emoji}</span>}
        <span>{display}{suffix}</span>
      </span>
    </td>
  )
}

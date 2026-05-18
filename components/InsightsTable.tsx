'use client'

import { useMemo } from 'react'
import type { WeatherModel } from '@/lib/models'
import { getColor } from '@/lib/colorScales'
import { weightedAvg, contrastText } from '@/lib/ensemble'
import { pickWeatherIcon, type WeatherIconId } from '@/lib/weatherIcon'

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
  gustsMax: number | null
  precipSum: number | null
  icon: WeatherIconId
}

const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const BUCKET_OPTIONS: BucketHours[] = [1, 2, 3, 4, 6, 12, 24]
const BUCKET_LABELS: Record<BucketHours, string> = {
  1: '1h', 2: '2h', 3: '3h', 4: '4h', 6: '6h', 12: '12h', 24: '1d',
}

const COND_EMOJI: Record<WeatherIconId, string> = {
  sunny: '☀️',
  partly: '🌤️',
  cloudy: '☁️',
  rainy: '🌧️',
  stormy: '⛈️',
  snowy: '❄️',
}

function tempEmoji(t: number | null): string {
  if (t === null) return ''
  if (t <= 0) return '🥶'
  if (t <= 10) return '🧊'
  if (t >= 30) return '🥵'
  if (t >= 25) return '🔥'
  return ''
}

function cloudEmoji(c: number | null): string {
  if (c === null) return ''
  if (c < 20) return '☀'
  if (c < 50) return '🌤'
  if (c < 80) return '⛅'
  return '☁'
}

function windEmoji(w: number | null): string {
  if (w === null) return ''
  if (w < 15) return '🍃'
  if (w < 40) return '💨'
  return '🌬️'
}

function precipEmoji(p: number | null): string {
  if (p === null || p === 0) return ''
  if (p < 0.5) return '💧'
  if (p < 3) return '🌧'
  return '⛈'
}

function bucketLabel(start: Date, bucket: BucketHours): string {
  const today = new Date()
  const isToday = start.getFullYear() === today.getFullYear() && start.getMonth() === today.getMonth() && start.getDate() === today.getDate()
  const isTomorrow = (() => {
    const t = new Date(today)
    t.setDate(t.getDate() + 1)
    return start.getFullYear() === t.getFullYear() && start.getMonth() === t.getMonth() && start.getDate() === t.getDate()
  })()
  const day = isToday ? 'Hoy' : isTomorrow ? 'Mañ' : `${DAYS_ES[start.getDay()]} ${start.getDate()}`
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
            label: bucketLabel(t, bucket),
            startIdx: i,
            endIdx: i,
            centerIdx: i,
            tempMean: null, tempMin: null, tempMax: null,
            cloudMean: null, windMean: null, gustsMax: null, precipSum: null,
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
          label: bucketLabel(new Date(startT.getTime() - startInBucket * 3600_000), bucket),
          startIdx: cursor,
          endIdx: end,
          centerIdx: cursor + Math.floor((end - cursor) / 2),
          tempMean: null, tempMin: null, tempMax: null,
          cloudMean: null, windMean: null, gustsMax: null, precipSum: null,
          icon: 'sunny',
        })
        cursor = end + 1
      }
    }

    for (const b of buckets) {
      let tSum = 0, tCount = 0
      let cSum = 0, cCount = 0
      let wSum = 0, wCount = 0
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
      }
      b.tempMean = tCount > 0 ? tSum / tCount : null
      b.cloudMean = cCount > 0 ? cSum / cCount : null
      b.windMean = wCount > 0 ? wSum / wCount : null
      b.icon = pickWeatherIcon({
        cloudCoverPct: b.cloudMean,
        precipitationMmDay: b.precipSum,
        windGustsKmh: b.gustsMax,
        minTempC: b.tempMin,
      })
    }

    return buckets
  }, [activeModels, times, series, bucket, maxHours])

  if (activeModels.length === 0) return null

  return (
    <div className="mb-4 animate-fadeIn">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-300">Insights</h3>
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
              <th className="sticky left-0 bg-gray-900 text-left px-2 py-1.5 font-medium z-10 border-b border-gray-800 min-w-[80px]">Cuándo</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800">Cond</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800">Temp °C</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800 hidden sm:table-cell">Nubes %</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800">Viento km/h</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800 hidden sm:table-cell">Rachas</th>
              <th className="text-center px-2 py-1.5 font-medium border-b border-gray-800">Lluvia mm</th>
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
                  <td className="text-center px-2 py-1.5 border-b border-gray-800/60 text-lg leading-none">
                    <span title={r.icon}>{COND_EMOJI[r.icon]}</span>
                  </td>
                  <Cell value={r.tempMean} metric="temperature" suffix="°" emoji={tempEmoji(r.tempMean)} tooltip={r.tempMin !== null && r.tempMax !== null ? `${r.tempMin.toFixed(1)}° – ${r.tempMax.toFixed(1)}°` : undefined} />
                  <Cell value={r.cloudMean} metric="cloud_cover" suffix="%" emoji={cloudEmoji(r.cloudMean)} hideOnMobile />
                  <Cell value={r.windMean} metric="wind_speed" emoji={windEmoji(r.windMean)} />
                  <Cell value={r.gustsMax} metric="wind_gusts" emoji={windEmoji(r.gustsMax)} hideOnMobile />
                  <Cell value={r.precipSum} metric="precipitation" decimals={1} emoji={precipEmoji(r.precipSum)} />
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
  metric: 'temperature' | 'cloud_cover' | 'wind_speed' | 'wind_gusts' | 'precipitation'
  suffix?: string
  emoji?: string
  decimals?: number
  tooltip?: string
  hideOnMobile?: boolean
}

function Cell({ value, metric, suffix = '', emoji = '', decimals = 0, tooltip, hideOnMobile }: CellProps) {
  const bg = getColor(metric, value)
  const text = value !== null ? contrastText(bg) : '#888'
  const display = value !== null
    ? (decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString())
    : '–'
  return (
    <td
      className={`text-center px-2 py-1.5 border-b border-gray-800/60 font-mono ${hideOnMobile ? 'hidden sm:table-cell' : ''}`}
      style={{ backgroundColor: bg, color: text }}
      title={tooltip}
    >
      <span className="inline-flex items-center gap-1 justify-center">
        {emoji && <span aria-hidden className="text-xs">{emoji}</span>}
        <span>{display}{suffix}</span>
      </span>
    </td>
  )
}

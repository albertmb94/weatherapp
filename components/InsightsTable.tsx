'use client'

import { useMemo, useState, useCallback, useRef } from 'react'
import type { WeatherModel } from '@/lib/models'
import { getColor } from '@/lib/colorScales'
import { weightedAvg, contrastText } from '@/lib/ensemble'
import { pickWeatherIcon, type WeatherIconId } from '@/lib/weatherIcon'
import { useLocale } from '@/lib/LocaleContext'
import { DAY_NAMES, STRINGS } from '@/lib/i18n'
import WeatherConditionIcon from './WeatherConditionIcon'

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
  showMarine?: boolean
  showBasic?: boolean
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
  pressureMean: number | null
  dewpointMean: number | null
  visibilityMean: number | null
  waveHeightMax: number | null
  wavePeriodMean: number | null
  waveDirection: number | null
  windWaveHeightMax: number | null
  windWavePeriodMean: number | null
  swellHeightMax: number | null
  swellPeriodMean: number | null
  hasMarineData: boolean
  icon: WeatherIconId
}

const BUCKET_OPTIONS: BucketHours[] = [1, 2, 3, 4, 6, 12, 24]
const BUCKET_LABELS: Record<BucketHours, string> = {
  1: '1h', 2: '2h', 3: '3h', 4: '4h', 6: '6h', 12: '12h', 24: '1d',
}

type MetricCellId =
  | 'cond' | 'temp' | 'min' | 'max' | 'clouds'
  | 'wind' | 'gusts' | 'precip' | 'humidity'
  | 'uv' | 'pressure' | 'dewpoint' | 'visibility'
  | 'wave_height' | 'wave_period' | 'wave_direction'
  | 'wind_wave_height' | 'wind_wave_period'
  | 'swell_wave_height' | 'swell_wave_period'

interface MetricColumnDef {
  id: MetricCellId
  labelKey: keyof typeof STRINGS['en']
  hideClass?: string
}

const METRIC_COLUMNS: MetricColumnDef[] = [
  { id: 'cond', labelKey: 'tableCond' },
  { id: 'temp', labelKey: 'tableTemp' },
  // Phones in landscape often sit just under the 768px md breakpoint once
  // the notch + home indicator safe area is subtracted (e.g. iPhone 16 lands
  // around 758px). Using sm + landscape keeps the secondary columns visible
  // on those devices while still hiding them on phones in portrait.
  { id: 'min', labelKey: 'tableMin', hideClass: 'hidden sm:table-cell landscape:table-cell' },
  { id: 'max', labelKey: 'tableMax', hideClass: 'hidden sm:table-cell landscape:table-cell' },
  { id: 'clouds', labelKey: 'tableClouds', hideClass: 'hidden sm:table-cell landscape:table-cell' },
  { id: 'wind', labelKey: 'tableWind' },
  { id: 'gusts', labelKey: 'tableGusts', hideClass: 'hidden sm:table-cell landscape:table-cell' },
  { id: 'precip', labelKey: 'tablePrecip' },
  { id: 'humidity', labelKey: 'tableHumidity' },
  { id: 'uv', labelKey: 'tableUv' },
  { id: 'pressure', labelKey: 'tablePressure', hideClass: 'hidden xl:table-cell' },
  { id: 'dewpoint', labelKey: 'tableDewpoint', hideClass: 'hidden xl:table-cell' },
  { id: 'visibility', labelKey: 'tableVisibility', hideClass: 'hidden xl:table-cell' },
  { id: 'wave_height', labelKey: 'tableWaveHeight', hideClass: 'hidden xl:table-cell marine-col' },
  { id: 'wave_period', labelKey: 'tableWavePeriod', hideClass: 'hidden xl:table-cell marine-col' },
  { id: 'wave_direction', labelKey: 'tableWaveDirection', hideClass: 'hidden xl:table-cell marine-col' },
  { id: 'wind_wave_height', labelKey: 'tableWindWaveHeight', hideClass: 'hidden xl:table-cell marine-col' },
  { id: 'wind_wave_period', labelKey: 'tableWindWavePeriod', hideClass: 'hidden xl:table-cell marine-col' },
  { id: 'swell_wave_height', labelKey: 'tableSwellHeight', hideClass: 'hidden xl:table-cell marine-col' },
  { id: 'swell_wave_period', labelKey: 'tableSwellPeriod', hideClass: 'hidden xl:table-cell marine-col' },
]

const DEFAULT_ORDER = METRIC_COLUMNS.map(c => c.id)
const STORAGE_KEY = 'insights-column-order'

function loadColumnOrder(): MetricCellId[] {
  if (typeof window === 'undefined') return DEFAULT_ORDER
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_ORDER
    const parsed = JSON.parse(raw) as string[]
    const validIds = new Set<string>(DEFAULT_ORDER)
    if (parsed.length === DEFAULT_ORDER.length && parsed.every(id => validIds.has(id))) {
      return parsed as MetricCellId[]
    }
  } catch {}
  return DEFAULT_ORDER
}

function saveColumnOrder(order: MetricCellId[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
  } catch {}
}

function tempEmoji(t: number | null): string {
  if (t === null) return ''
  if (t <= 0) return '🥶'
  if (t >= 30) return '🥵'
  return ''
}

function WindArrow({ degrees }: { degrees: number | null }) {
  if (degrees === null) return null
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

function CellContent({ id, r }: { id: MetricCellId; r: Row }) {
  switch (id) {
    case 'cond':
      return <span className="inline-flex items-center justify-center"><WeatherConditionIcon icon={r.icon} size="sm" /></span>
    case 'temp':
      return <CellInner value={r.tempMean} metric="temperature" suffix="°" />
    case 'min':
      return <CellInner value={r.tempMin} metric="temperature" suffix="°" emoji={tempEmoji(r.tempMin)} />
    case 'max':
      return <CellInner value={r.tempMax} metric="temperature" suffix="°" emoji={tempEmoji(r.tempMax)} />
    case 'clouds':
      return <CellInner value={r.cloudMean} metric="cloud_cover" suffix="%" />
    case 'wind':
      return <CellInner value={r.windMean} metric="wind_speed" icon={<WindArrow degrees={r.windDirection} />} tooltip={r.windDirection !== null ? `${Math.round(r.windDirection)}°` : undefined} />
    case 'gusts':
      return <CellInner value={r.gustsMax} metric="wind_gusts" icon={<WindArrow degrees={r.windDirection} />} tooltip={r.windDirection !== null ? `${Math.round(r.windDirection)}°` : undefined} />
    case 'precip':
      return <CellInner value={r.precipSum} metric="precipitation" decimals={1} />
    case 'humidity':
      return <CellInner value={r.humidityMean} metric="humidity" suffix="%" />
    case 'uv':
      return <CellInner value={r.uvIndexMean} metric="uv_index" decimals={1} />
    case 'pressure':
      return <CellInner value={r.pressureMean} metric="pressure" decimals={0} />
    case 'dewpoint':
      return <CellInner value={r.dewpointMean} metric="dewpoint" suffix="°" decimals={1} />
    case 'visibility':
      return <CellInner value={r.visibilityMean} metric="visibility" suffix="km" decimals={1} />
    case 'wave_height':
      return <CellInner value={r.waveHeightMax} metric="wave_height" suffix="m" decimals={1} />
    case 'wave_period':
      return <CellInner value={r.wavePeriodMean} metric="wave_period" suffix="s" decimals={0} />
    case 'wave_direction':
      return <CellInner value={r.waveDirection} metric="wave_direction" suffix="°" decimals={0} icon={<WindArrow degrees={r.waveDirection} />} tooltip={r.waveDirection !== null ? `${Math.round(r.waveDirection)}°` : undefined} />
    case 'wind_wave_height':
      return <CellInner value={r.windWaveHeightMax} metric="wind_wave_height" suffix="m" decimals={1} />
    case 'wind_wave_period':
      return <CellInner value={r.windWavePeriodMean} metric="wind_wave_period" suffix="s" decimals={0} />
    case 'swell_wave_height':
      return <CellInner value={r.swellHeightMax} metric="swell_wave_height" suffix="m" decimals={1} />
    case 'swell_wave_period':
      return <CellInner value={r.swellPeriodMean} metric="swell_wave_period" suffix="s" decimals={0} />
  }
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
  showMarine = false,
  showBasic = true,
}: InsightsTableProps) {
  const { locale } = useLocale()
  const activeModels = useMemo(
    () => models.filter(m => activeModelIds.includes(m.id)),
    [models, activeModelIds]
  )

  const [columnOrder, setColumnOrder] = useState<MetricCellId[]>(loadColumnOrder)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const dragNodeRef = useRef<HTMLTableCellElement | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    setDragIdx(idx)
    dragNodeRef.current = e.currentTarget as HTMLTableCellElement
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', '')
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverIdx(idx)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, dropIdx: number) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === dropIdx) {
      setDragIdx(null)
      setOverIdx(null)
      return
    }
    setColumnOrder(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(dropIdx, 0, moved)
      saveColumnOrder(next)
      return next
    })
    setDragIdx(null)
    setOverIdx(null)
  }, [dragIdx])

  const handleDragEnd = useCallback(() => {
    setDragIdx(null)
    setOverIdx(null)
  }, [])

  const resetColumnOrder = useCallback(() => {
    setColumnOrder(DEFAULT_ORDER)
    saveColumnOrder(DEFAULT_ORDER)
  }, [])

  const isDefaultOrder = useMemo(
    () => columnOrder.every((id, i) => id === DEFAULT_ORDER[i]),
    [columnOrder]
  )

  const rows = useMemo<Row[]>(() => {
    if (activeModels.length === 0 || times.length === 0) return []
    const weights = activeModels.map(m => m.weight)
    const limit = Math.min(times.length, maxHours)
    const buckets: Row[] = []
    let cursor = 0

    const emptyMarine = {
      waveHeightMax: null,
      wavePeriodMean: null,
      waveDirection: null,
      windWaveHeightMax: null,
      windWavePeriodMean: null,
      swellHeightMax: null,
      swellPeriodMean: null,
      hasMarineData: false,
    } as const

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
            pressureMean: null, dewpointMean: null, visibilityMean: null,
            ...emptyMarine,
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
          pressureMean: null, dewpointMean: null, visibilityMean: null,
          ...emptyMarine,
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
      let prSum = 0, prCount = 0
      let dpSum = 0, dpCount = 0
      let visSum = 0, visCount = 0
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
        const prVals = activeModels.map(m => series[m.id]?.['pressure']?.[i] ?? null)
        const prEns = weightedAvg(prVals, weights)
        if (prEns !== null) { prSum += prEns; prCount += 1 }
        const dpVals = activeModels.map(m => series[m.id]?.['dewpoint']?.[i] ?? null)
        const dpEns = weightedAvg(dpVals, weights)
        if (dpEns !== null) { dpSum += dpEns; dpCount += 1 }
        const visVals = activeModels.map(m => {
          const v = series[m.id]?.['visibility']?.[i]
          return v !== null && v !== undefined ? v / 1000 : null
        })
        const visEns = weightedAvg(visVals, weights)
        if (visEns !== null) { visSum += visEns; visCount += 1 }
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

        // Marine aggregates (single-source from marine_global, no ensemble).
        const mSeries = series['marine_global']
        if (mSeries) {
          const wh = mSeries['wave_height']?.[i] ?? null
          const wp = mSeries['wave_period']?.[i] ?? null
          const wd = mSeries['wave_direction']?.[i] ?? null
          const wwh = mSeries['wind_wave_height']?.[i] ?? null
          const wwp = mSeries['wind_wave_period']?.[i] ?? null
          const swh = mSeries['swell_wave_height']?.[i] ?? null
          const swp = mSeries['swell_wave_period']?.[i] ?? null
          if (wh !== null && wh !== undefined) {
            b.waveHeightMax = b.waveHeightMax === null ? wh : Math.max(b.waveHeightMax, wh)
            b.hasMarineData = true
          }
          if (wp !== null && wp !== undefined) {
            b.wavePeriodMean = b.wavePeriodMean === null ? wp : (b.wavePeriodMean + wp) / 2
            b.hasMarineData = true
          }
          if (wwh !== null && wwh !== undefined) {
            b.windWaveHeightMax = b.windWaveHeightMax === null ? wwh : Math.max(b.windWaveHeightMax, wwh)
          }
          if (wwp !== null && wwp !== undefined) {
            b.windWavePeriodMean = b.windWavePeriodMean === null ? wwp : (b.windWavePeriodMean + wwp) / 2
          }
          if (swh !== null && swh !== undefined) {
            b.swellHeightMax = b.swellHeightMax === null ? swh : Math.max(b.swellHeightMax, swh)
          }
          if (swp !== null && swp !== undefined) {
            b.swellPeriodMean = b.swellPeriodMean === null ? swp : (b.swellPeriodMean + swp) / 2
          }
          if (wd !== null && wd !== undefined) {
            b.waveDirection = wd
          }
        }
      }
      b.tempMean = tCount > 0 ? tSum / tCount : null
      b.cloudMean = cCount > 0 ? cSum / cCount : null
      b.windMean = wCount > 0 ? wSum / wCount : null
      b.humidityMean = hCount > 0 ? hSum / hCount : null
      b.uvIndexMean = uCount > 0 ? uSum / uCount : null
      b.pressureMean = prCount > 0 ? prSum / prCount : null
      b.dewpointMean = dpCount > 0 ? dpSum / dpCount : null
      b.visibilityMean = visCount > 0 ? visSum / visCount : null
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

  const MARINE_COL_IDS = new Set<MetricCellId>([
    'wave_height', 'wave_period', 'wave_direction',
    'wind_wave_height', 'wind_wave_period',
    'swell_wave_height', 'swell_wave_period',
  ])
  const visibleIds = columnOrder.filter(id => {
    if (!showMarine && MARINE_COL_IDS.has(id)) return false
    if (showMarine && !showBasic && !MARINE_COL_IDS.has(id)) return false
    return true
  })
  const colDefs = visibleIds.map(id => METRIC_COLUMNS.find(c => c.id === id)!)

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
          {!isDefaultOrder && (
            <button
              onClick={resetColumnOrder}
              className="px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors min-h-[28px] text-gray-500 hover:text-white ml-0.5"
              title="Reset column order"
            >
              ↺
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-gray-800">
        <table className="w-full border-collapse text-xs table-fixed">
          <thead>
            <tr className="bg-gray-900 text-gray-400">
              <th className="sticky left-0 bg-gray-900 text-left px-2 py-1.5 font-medium z-10 border-b border-gray-800 w-[80px]">{STRINGS[locale].tableWhen}</th>
              {colDefs.map((col, idx) => {
                const dragClass = idx === dragIdx ? 'opacity-40' : idx === overIdx && dragIdx !== null && idx !== dragIdx ? 'border-t-2 border-t-blue-500' : ''
                return (
                  <th
                    key={col.id}
                    draggable
                    onDragStart={e => handleDragStart(e, idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDrop={e => handleDrop(e, idx)}
                    onDragEnd={handleDragEnd}
                    className={`text-center px-2 py-1.5 font-medium border-b border-gray-800 cursor-grab active:cursor-grabbing select-none ${col.hideClass ?? ''} ${dragClass}`}
                    title="Drag to reorder"
                  >
                    {STRINGS[locale][col.labelKey]}
                  </th>
                )
              })}
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
                  {colDefs.map(col => (
                    <td
                      key={col.id}
                      className={col.hideClass}
                    >
                      <CellContent id={col.id} r={r} />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface CellInnerProps {
  value: number | null
  metric: 'temperature' | 'cloud_cover' | 'wind_speed' | 'wind_gusts' | 'precipitation' | 'humidity' | 'uv_index' | 'pressure' | 'dewpoint' | 'visibility' | 'wave_height' | 'wave_period' | 'wave_direction' | 'wind_wave_height' | 'wind_wave_period' | 'swell_wave_height' | 'swell_wave_period'
  suffix?: string
  emoji?: string
  icon?: React.ReactNode
  decimals?: number
  tooltip?: string
}

function CellInner({ value, metric, suffix = '', emoji = '', icon, decimals = 0, tooltip }: CellInnerProps) {
  const bg = getColor(metric, value)
  const text = value !== null ? contrastText(bg) : '#888'
  const display = value !== null
    ? (decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString())
    : '–'
  return (
    <span
      className="text-center px-2 py-1.5 font-mono inline-flex items-center gap-1 justify-center w-full"
      style={{ backgroundColor: bg, color: text }}
      title={tooltip}
    >
      {icon ? icon : emoji && <span aria-hidden className="text-xs">{emoji}</span>}
      <span>{display}{suffix}</span>
    </span>
  )
}

'use client'

import { useMemo, useState, useCallback, useRef, useEffect, memo } from 'react'
import type { WeatherModel } from '@/lib/models'
import { ENSEMBLE_PRESETS, METRIC_TO_ENSEMBLE, getLeadTimeBucket } from '@/lib/models'
import { getColor, SCALES } from '@/lib/colorScales'
import type { ScaleMetric } from '@/lib/colorScales'
import { weightedAvg } from '@/lib/ensemble'
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
  utcOffsetSeconds: number
  showMarine?: boolean
  onMarineToggle?: () => void
  showBasic?: boolean
  onBasicToggle?: () => void
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
  seaTempMean: number | null
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

const BUCKET_OPTIONS: BucketHours[] = [1, 2, 6, 12, 24]
const BUCKET_LABELS: Record<BucketHours, string> = {
  1: '1h', 2: '2h', 3: '3h', 4: '4h', 6: '6h', 12: '12h', 24: '1d',
}

type MetricCellId =
  | 'cond' | 'temp' | 'min' | 'max' | 'clouds'
  | 'wind' | 'gusts' | 'precip' | 'humidity'
  | 'uv' | 'pressure' | 'dewpoint' | 'visibility'
  | 'sea_surface_temperature'
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
  { id: 'sea_surface_temperature', labelKey: 'tableSeaTemp', hideClass: 'marine-col' },
  { id: 'wave_height', labelKey: 'tableWaveHeight', hideClass: 'marine-col' },
  { id: 'wave_period', labelKey: 'tableWavePeriod', hideClass: 'marine-col' },
  { id: 'wave_direction', labelKey: 'tableWaveDirection', hideClass: 'marine-col' },
  { id: 'wind_wave_height', labelKey: 'tableWindWaveHeight', hideClass: 'marine-col' },
  { id: 'wind_wave_period', labelKey: 'tableWindWavePeriod', hideClass: 'marine-col' },
  { id: 'swell_wave_height', labelKey: 'tableSwellHeight', hideClass: 'marine-col' },
  { id: 'swell_wave_period', labelKey: 'tableSwellPeriod', hideClass: 'marine-col' },
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

/**
 * Convert an rgb()/hex colour to its raw "r, g, b" triple so it can be
 * dropped into an rgba(...) value. Used to layer translucent gradients on
 * top of the Insights table cells.
 */
function rgbTriple(color: string): string {
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (m) return `${m[1]}, ${m[2]}, ${m[3]}`
  const hex = color.replace('#', '')
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return `${r}, ${g}, ${b}`
  }
  return '120, 120, 120'
}

/**
 * Map the metric value to a 0..1 "intensity" used to drive how saturated
 * the cell shading is. We pick the closest scale stop and weight by how
 * far the value is from the scale's neutral midpoint. 0 = neutral / cool,
 * 1 = extreme. Returns null when the value is missing or the metric has
 * no usable scale.
 */
function intensityFor(metric: ScaleMetric, value: number | null): number | null {
  if (value === null || value === undefined) return null
  const stops = SCALES[metric]
  if (!stops || stops.length === 0) return null
  // Find the enclosing stop pair.
  let lo = stops[0]
  let hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (value >= stops[i].value && value <= stops[i + 1].value) {
      lo = stops[i]
      hi = stops[i + 1]
      break
    }
  }
  if (value <= stops[0].value) {
    lo = stops[0]
    hi = stops[0]
  } else if (value >= stops[stops.length - 1].value) {
    lo = stops[stops.length - 1]
    hi = stops[stops.length - 1]
  }
  const loDist = Math.abs(value - lo.value)
  const hiDist = Math.abs(value - hi.value)
  const range = Math.max(1, hi.value - lo.value)
  const proximity = 1 - (loDist + hiDist) / (range * 2) // 0 (far from stops) … 1 (at a stop)
  return Math.max(0.35, Math.min(1, 0.4 + proximity * 0.6))
}

/**
 * Build the heatmap cell background. We use a soft radial gradient so
 * the colour diffuses before reaching the cell border, but the gradient
 * is intentionally simple (2 stops) so it remains cheap to paint at the
 * 14 rows × 14 columns size the table reaches on mobile.
 */
function heatStyle(metric: ScaleMetric, value: number | null): React.CSSProperties {
  if (value === null || value === undefined) {
    return { background: 'transparent' }
  }
  const color = getColor(metric, value)
  const triple = rgbTriple(color)
  const intensity = intensityFor(metric, value) ?? 0.5
  // Capped alpha stops so a 14x14 cell grid paints quickly on slow
  // mobile GPUs while still showing the "soft glow" character.
  const core = Math.round(intensity * 45)   // 0..45% alpha at the very core
  const mid = Math.round(intensity * 18)    // 0..18% at the mid radius
  return {
    ['--heat-rgb-triple' as string]: triple,
    background: `radial-gradient(ellipse 32% 60% at 50% 50%, rgba(${triple},${core}%) 0%, rgba(${triple},${mid}%) 50%, rgba(${triple},0) 92%)`,
  } as React.CSSProperties
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

function bucketLabel(start: Date, end: Date, bucket: BucketHours, locale: 'es' | 'en', utcOffsetSeconds: number): string {
  // M5: compare the location's "today" (in the location's timezone) instead
  // of the browser's "today", otherwise the label flips between "Hoy" /
  // "Mañ" and a weekday at the wrong moment when the user is in a TZ
  // different from the location.
  const today = new Date(Date.now() + utcOffsetSeconds * 1000)
  const isToday = start.getUTCFullYear() === today.getUTCFullYear() && start.getUTCMonth() === today.getUTCMonth() && start.getUTCDate() === today.getUTCDate()
  const isTomorrow = (() => {
    const t = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    return start.getUTCFullYear() === t.getUTCFullYear() && start.getUTCMonth() === t.getUTCMonth() && start.getUTCDate() === t.getUTCDate()
  })()
  const s = STRINGS[locale]
  const day = isToday ? s.today : isTomorrow ? s.tomorrow : `${DAY_NAMES[locale][start.getUTCDay()]} ${start.getUTCDate()}`
  if (bucket === 24) return day
  const h0 = start.getUTCHours().toString().padStart(2, '0')
  if (bucket === 1) return `${day} ${h0}:00`
  const h1 = end.getUTCHours().toString().padStart(2, '0')
  return `${day} ${h0}–${h1}`
}

interface CellResult {
  node: React.ReactNode
  style?: React.CSSProperties
  /** When set, the cell renders with an extra ring/badge for the active row. */
  textClassName?: string
}

function cellData(id: MetricCellId, r: Row): CellResult {
  switch (id) {
    case 'cond':
      return { node: <span className="inline-flex items-center justify-center"><WeatherConditionIcon icon={r.icon} size="sm" /></span> }
    case 'temp':
      return cellInner({ value: r.tempMean, metric: 'temperature', suffix: '°' })
    case 'min':
      return cellInner({ value: r.tempMin, metric: 'temperature', suffix: '°' })
    case 'max':
      return cellInner({ value: r.tempMax, metric: 'temperature', suffix: '°' })
    case 'clouds':
      return cellInner({ value: r.cloudMean, metric: 'cloud_cover', suffix: '%' })
    case 'wind':
      return cellInner({ value: r.windMean, metric: 'wind_speed', icon: <WindArrow degrees={r.windDirection} />, tooltip: r.windDirection !== null ? `${Math.round(r.windDirection)}°` : undefined })
    case 'gusts':
      return cellInner({ value: r.gustsMax, metric: 'wind_gusts', icon: <WindArrow degrees={r.windDirection} />, tooltip: r.windDirection !== null ? `${Math.round(r.windDirection)}°` : undefined })
    case 'precip':
      return cellInner({ value: r.precipSum, metric: 'precipitation', decimals: 1 })
    case 'humidity':
      return cellInner({ value: r.humidityMean, metric: 'humidity', suffix: '%' })
    case 'uv':
      return cellInner({ value: r.uvIndexMean, metric: 'uv_index', decimals: 1 })
    case 'pressure':
      return cellInner({ value: r.pressureMean, metric: 'pressure', decimals: 0 })
    case 'dewpoint':
      return cellInner({ value: r.dewpointMean, metric: 'dewpoint', suffix: '°', decimals: 1 })
    case 'visibility':
      return cellInner({ value: r.visibilityMean, metric: 'visibility', suffix: 'km', decimals: 1 })
    case 'sea_surface_temperature':
      return cellInner({ value: r.seaTempMean, metric: 'sea_surface_temperature', suffix: '°', decimals: 1 })
    case 'wave_height':
      return cellInner({ value: r.waveHeightMax, metric: 'wave_height', suffix: 'm', decimals: 1 })
    case 'wave_period':
      return cellInner({ value: r.wavePeriodMean, metric: 'wave_period', suffix: 's', decimals: 0 })
    case 'wave_direction':
      return cellInner({ value: r.waveDirection, metric: 'wave_direction', suffix: '°', decimals: 0, icon: <WindArrow degrees={r.waveDirection} />, tooltip: r.waveDirection !== null ? `${Math.round(r.waveDirection)}°` : undefined })
    case 'wind_wave_height':
      return cellInner({ value: r.windWaveHeightMax, metric: 'wind_wave_height', suffix: 'm', decimals: 1 })
    case 'wind_wave_period':
      return cellInner({ value: r.windWavePeriodMean, metric: 'wind_wave_period', suffix: 's', decimals: 0 })
    case 'swell_wave_height':
      return cellInner({ value: r.swellHeightMax, metric: 'swell_wave_height', suffix: 'm', decimals: 1 })
    case 'swell_wave_period':
      return cellInner({ value: r.swellPeriodMean, metric: 'swell_wave_period', suffix: 's', decimals: 0 })
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
  utcOffsetSeconds,
  showMarine = false,
  onMarineToggle,
  showBasic = true,
  onBasicToggle,
}: InsightsTableProps) {
  const { locale } = useLocale()
  const activeModels = useMemo(
    () => models.filter(m => activeModelIds.includes(m.id)),
    [models, activeModelIds]
  )

  const [columnOrder, setColumnOrder] = useState<MetricCellId[]>(loadColumnOrder)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const [compact, setCompact] = useState(false)
  const [showAllRows, setShowAllRows] = useState(false)
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

  // Reset showAllRows when bucket changes so the user has to click again
  const prevBucketRef = useRef(bucket)
  useEffect(() => {
    if (prevBucketRef.current !== bucket) {
      setShowAllRows(false)
      prevBucketRef.current = bucket
    }
  }, [bucket])

  const isDefaultOrder = useMemo(
    () => columnOrder.every((id, i) => id === DEFAULT_ORDER[i]),
    [columnOrder]
  )

  const rows = useMemo<Row[]>(() => {
    if (activeModels.length === 0 || times.length === 0) return []
    const effectiveMaxHours = (bucket === 1 || bucket === 2) ? Math.min(maxHours, 120) : maxHours
    const limit = Math.min(times.length, effectiveMaxHours)

    // Build per-metric, per-hour weight arrays using ensemble presets
    const modelIds = activeModels.map(m => m.id)
    const getWeightsForMetricAndHour = (metric: string, hourIndex: number): number[] => {
      const presetId = METRIC_TO_ENSEMBLE[metric] ?? 'temperature'
      const preset = ENSEMBLE_PRESETS.find(p => p.id === presetId) ?? ENSEMBLE_PRESETS[0]
      const leadTimeHours = hourIndex * bucket
      const leadBucket = getLeadTimeBucket(leadTimeHours)
      const bucketWeights = preset.weights[leadBucket] ?? preset.weights['0-48h']
      return modelIds.map(id => bucketWeights[id] ?? 0.01)
    }

    const buckets: Row[] = []
    let cursor = 0

    const emptyMarine = {
      seaTempMean: null,
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
        if (!(t instanceof Date)) continue
        const key = `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`
        if (!current || key !== currentKey) {
          current = {
            label: bucketLabel(t, t, bucket, locale, utcOffsetSeconds),
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
        if (t.getUTCHours() === 12) current.centerIdx = i
      }
    } else {
      while (cursor < limit) {
        const startT = times[cursor]
        if (!(startT instanceof Date)) break
        const startHour = startT.getUTCHours()
        const alignedStart = startHour - (startHour % bucket)
        const startInBucket = startHour - alignedStart
        const remaining = bucket - startInBucket
        const end = Math.min(cursor + remaining, limit) - 1
        if (end < cursor) break
        const endT = times[end]
        buckets.push({
          label: bucketLabel(new Date(startT.getTime() - startInBucket * 3600_000), endT, bucket, locale, utcOffsetSeconds),
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
      let sstSum = 0, sstCount = 0
      let wpSum = 0, wpCount = 0
      let wwpSum = 0, wwpCount = 0
      let swpSum = 0, swpCount = 0
      for (let i = b.startIdx; i <= b.endIdx; i++) {
        // Use per-metric, per-hour weights for proper ensemble selection
        const tWeights = getWeightsForMetricAndHour('temperature', i)
        const tVals = activeModels.map(m => series[m.id]?.['temperature']?.[i] ?? null)
        const tEns = weightedAvg(tVals, tWeights)
        if (tEns !== null) {
          tSum += tEns
          tCount += 1
          if (b.tempMin === null || tEns < b.tempMin) b.tempMin = tEns
          if (b.tempMax === null || tEns > b.tempMax) b.tempMax = tEns
        }
        const cWeights = getWeightsForMetricAndHour('cloud_cover', i)
        const cVals = activeModels.map(m => series[m.id]?.['cloud_cover']?.[i] ?? null)
        const cEns = weightedAvg(cVals, cWeights)
        if (cEns !== null) { cSum += cEns; cCount += 1 }
        const wWeights = getWeightsForMetricAndHour('wind_speed', i)
        const wVals = activeModels.map(m => series[m.id]?.['wind_speed']?.[i] ?? null)
        const wEns = weightedAvg(wVals, wWeights)
        if (wEns !== null) { wSum += wEns; wCount += 1 }
        const gWeights = getWeightsForMetricAndHour('wind_gusts', i)
        const gVals = activeModels.map(m => series[m.id]?.['wind_gusts']?.[i] ?? null)
        const gEns = weightedAvg(gVals, gWeights)
        if (gEns !== null && (b.gustsMax === null || gEns > b.gustsMax)) b.gustsMax = gEns
        const pWeights = getWeightsForMetricAndHour('precipitation', i)
        const pVals = activeModels.map(m => series[m.id]?.['precipitation']?.[i] ?? null)
        const pEns = weightedAvg(pVals, pWeights)
        if (pEns !== null) b.precipSum = (b.precipSum ?? 0) + pEns
        const hWeights = getWeightsForMetricAndHour('humidity', i)
        const hVals = activeModels.map(m => series[m.id]?.['humidity']?.[i] ?? null)
        const hEns = weightedAvg(hVals, hWeights)
        if (hEns !== null) { hSum += hEns; hCount += 1 }
        const uWeights = getWeightsForMetricAndHour('uv_index', i)
        const uVals = activeModels.map(m => series[m.id]?.['uv_index']?.[i] ?? null)
        const uEns = weightedAvg(uVals, uWeights)
        if (uEns !== null) { uSum += uEns; uCount += 1 }
        const prWeights = getWeightsForMetricAndHour('pressure', i)
        const prVals = activeModels.map(m => series[m.id]?.['pressure']?.[i] ?? null)
        const prEns = weightedAvg(prVals, prWeights)
        if (prEns !== null) { prSum += prEns; prCount += 1 }
        const dpWeights = getWeightsForMetricAndHour('dewpoint', i)
        const dpVals = activeModels.map(m => series[m.id]?.['dewpoint']?.[i] ?? null)
        const dpEns = weightedAvg(dpVals, dpWeights)
        if (dpEns !== null) { dpSum += dpEns; dpCount += 1 }
        const visWeights = getWeightsForMetricAndHour('visibility', i)
        const visVals = activeModels.map(m => {
          const v = series[m.id]?.['visibility']?.[i]
          return v !== null && v !== undefined ? v / 1000 : null
        })
        const visEns = weightedAvg(visVals, visWeights)
        if (visEns !== null) { visSum += visEns; visCount += 1 }
        const dirWeights = getWeightsForMetricAndHour('wind_direction', i)
        let hCos = 0, hSin = 0, hW = 0
        for (let j = 0; j < activeModels.length; j++) {
          const d = series[activeModels[j].id]?.['wind_direction']?.[i]
          if (d === null || d === undefined) continue
          const rad = (d * Math.PI) / 180
          hCos += Math.cos(rad) * dirWeights[j]
          hSin += Math.sin(rad) * dirWeights[j]
          hW += dirWeights[j]
        }
        if (hW > 0) {
          dirCos += hCos / hW
          dirSin += hSin / hW
          dirCount += 1
        }

        // Marine aggregates (single-source from marine_global, no ensemble).
        const mSeries = series['marine_global']
        if (mSeries) {
          const sst = mSeries['sea_surface_temperature']?.[i] ?? null
          const wh = mSeries['wave_height']?.[i] ?? null
          const wp = mSeries['wave_period']?.[i] ?? null
          const wd = mSeries['wave_direction']?.[i] ?? null
          const wwh = mSeries['wind_wave_height']?.[i] ?? null
          const wwp = mSeries['wind_wave_period']?.[i] ?? null
          const swh = mSeries['swell_wave_height']?.[i] ?? null
          const swp = mSeries['swell_wave_period']?.[i] ?? null
          if (sst !== null && sst !== undefined) {
            sstSum += sst
            sstCount += 1
            b.hasMarineData = true
          }
          if (wh !== null && wh !== undefined) {
            b.waveHeightMax = b.waveHeightMax === null ? wh : Math.max(b.waveHeightMax, wh)
            b.hasMarineData = true
          }
          if (wp !== null && wp !== undefined) {
            wpSum += wp
            wpCount += 1
            b.hasMarineData = true
          }
          if (wwh !== null && wwh !== undefined) {
            b.windWaveHeightMax = b.windWaveHeightMax === null ? wwh : Math.max(b.windWaveHeightMax, wwh)
          }
          if (wwp !== null && wwp !== undefined) {
            wwpSum += wwp
            wwpCount += 1
          }
          if (swh !== null && swh !== undefined) {
            b.swellHeightMax = b.swellHeightMax === null ? swh : Math.max(b.swellHeightMax, swh)
          }
          if (swp !== null && swp !== undefined) {
            swpSum += swp
            swpCount += 1
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
      b.seaTempMean = sstCount > 0 ? sstSum / sstCount : null
      b.wavePeriodMean = wpCount > 0 ? wpSum / wpCount : null
      b.windWavePeriodMean = wwpCount > 0 ? wwpSum / wwpCount : null
      b.swellPeriodMean = swpCount > 0 ? swpSum / swpCount : null
      b.icon = pickWeatherIcon({
        cloudCoverPct: b.cloudMean,
        precipitationMmDay: b.precipSum,
        windGustsKmh: b.gustsMax,
        minTempC: b.tempMin,
      })
    }

    return buckets
  }, [activeModels, times, series, bucket, maxHours, locale, utcOffsetSeconds])

  const marineColIds = useMemo(
    () => new Set<MetricCellId>([
      'sea_surface_temperature',
      'wave_height', 'wave_period', 'wave_direction',
      'wind_wave_height', 'wind_wave_period',
      'swell_wave_height', 'swell_wave_period',
    ]),
    []
  )
  const COMPACT_HIDDEN_COLS = useMemo(
    () => new Set<MetricCellId>([
      'min', 'max', 'clouds', 'gusts', 'humidity', 'uv', 'pressure', 'dewpoint', 'visibility',
    ]),
    []
  )
  const visibleIds = useMemo(
    () => columnOrder.filter(id => {
      if (!showMarine && marineColIds.has(id)) return false
      if (showMarine && !showBasic && !marineColIds.has(id)) return false
      return true
    }),
    [columnOrder, showMarine, showBasic, marineColIds]
  )
  const colDefs = useMemo(
    () => visibleIds.map(id => METRIC_COLUMNS.find(c => c.id === id)!),
    [visibleIds]
  )

  // Pre-compute each row's cells once. Without this, the cellData() switch
  // is invoked 14 cols x 14 rows = 196 times per render even when the
  // table itself is not in the active viewport.
  const cellsByRow = useMemo(() => {
    const result: CellResult[][] = []
    for (const r of rows) {
      const row: CellResult[] = []
      for (const col of colDefs) {
        row.push(cellData(col.id, r))
      }
      result.push(row)
    }
    return result
  }, [rows, colDefs])

  if (activeModels.length === 0) return null

  return (
    <div className="mb-4 animate-fadeIn">
      <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold mb-3">
        {STRINGS[locale].insightsTitle}
        {(bucket === 1 || bucket === 2) && (
          <span className="ml-2 normal-case tracking-normal font-normal text-text-muted">
            (Próximas 120h)
          </span>
        )}
      </h3>
      <div className="rounded-2xl border border-border bg-surface-raised overflow-hidden">
        <div className="flex items-center gap-0.5 px-2 py-2 overflow-x-auto scrollbar-none border-b border-border">
          {BUCKET_OPTIONS.map(b => (
            <button
              key={b}
              onClick={() => onBucketChange(b)}
              className={`flex-1 px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors min-h-[28px] ${
                bucket === b ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {BUCKET_LABELS[b]}
            </button>
          ))}
          {onMarineToggle && (
            <button
              type="button"
              onClick={onMarineToggle}
              aria-pressed={showMarine}
              aria-label={STRINGS[locale].marine}
              title={STRINGS[locale].marine}
              className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-colors min-h-[28px] border ${
                showMarine
                  ? 'bg-cyan-500 text-white border-cyan-500'
                  : 'bg-surface-popover text-text-secondary border-border'
              }`}
            >
              {STRINGS[locale].marine}
            </button>
          )}
          {onBasicToggle && (
            <button
              type="button"
              onClick={onBasicToggle}
              aria-pressed={showBasic}
              aria-label={STRINGS[locale].basic}
              title={STRINGS[locale].basic}
              className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-colors min-h-[28px] border ${
                showBasic
                  ? 'bg-emerald-500 text-white border-emerald-500'
                  : 'bg-surface-popover text-text-secondary border-border'
              }`}
            >
              {STRINGS[locale].basic}
            </button>
          )}
          {!isDefaultOrder && (
            <button
              onClick={resetColumnOrder}
              className="shrink-0 px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors min-h-[28px] text-text-tertiary hover:text-text-secondary ml-0.5"
              title="Reset column order"
            >
              ↺
            </button>
          )}
          <button
            onClick={() => setCompact(c => !c)}
            className={`shrink-0 md:hidden px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors min-h-[28px] ${compact ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'}`}
            title="Compact mode"
          >
            ≡
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className={`w-full border-collapse text-xs [&_th]:text-[11px] [&_td]:text-[11px] [&_span]:text-[11px] ${showMarine ? 'table-auto' : 'table-fixed'}`}>
          <thead>
            <tr className="bg-surface text-text-secondary">
              <th
                style={{ background: 'var(--surface)' }}
                className="sticky left-0 top-0 isolate z-40 text-center px-1.5 py-1.5 font-medium border-b border-border w-[64px] shadow-[2px_0_4px_rgba(0,0,0,0.5)]"
              >
                {STRINGS[locale].tableWhen}
              </th>
              {colDefs.map((col, idx) => {
                const dragClass = idx === dragIdx ? 'opacity-40' : idx === overIdx && dragIdx !== null && idx !== dragIdx ? 'border-t-2 border-t-accent' : ''
                return (
                  <th
                    key={col.id}
                    draggable
                    onDragStart={e => handleDragStart(e, idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDrop={e => handleDrop(e, idx)}
                    onDragEnd={handleDragEnd}
                    className={`sticky top-0 bg-surface text-center px-1 py-1.5 font-medium border-b border-border cursor-grab active:cursor-grabbing select-none tabular-nums text-text-secondary ${col.hideClass ?? ''} ${compact && COMPACT_HIDDEN_COLS.has(col.id) ? 'hidden' : ''} ${dragClass}`}
                    title="Drag to reorder"
                  >
                    {STRINGS[locale][col.labelKey]}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {(showAllRows ? rows : rows.slice(0, 50)).map((r, i) => {
              const isActive = selectedHour >= r.startIdx && selectedHour <= r.endIdx
              const zebra = i % 2 === 1
              const whenBg = isActive
                ? 'bg-accent-soft/70 ring-1 ring-inset ring-accent/40'
                : zebra
                  ? 'bg-surface-raised/30'
                  : 'bg-transparent'
              const rowCells = cellsByRow[i] ?? []
              return (
                <tr
                  key={i}
                  onClick={() => onSelectHour(r.centerIdx)}
                  className="cursor-pointer transition-colors hover:[&>td]:bg-accent/10 contain-[layout_style_paint]"
                >
                  <td
                    style={{ background: 'var(--surface)' }}
                    className={`sticky left-0 isolate z-30 px-1.5 py-1.5 ${showMarine ? 'whitespace-nowrap' : 'whitespace-normal'} text-text-primary border-b border-border/60 shadow-[2px_0_4px_rgba(0,0,0,0.5)] tabular-nums ${whenBg}`}
                  >
                    {r.label}
                  </td>
                  {colDefs.map((col, j) => (
                    <HeatCell
                      key={col.id}
                      node={rowCells[j]?.node}
                      style={rowCells[j]?.style}
                      hideOnCompact={compact && COMPACT_HIDDEN_COLS.has(col.id)}
                      extraClass={col.hideClass ?? ''}
                    />
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length > 50 && !showAllRows ? (
          <div className="border-t border-border bg-surface-popover/30 px-3 py-2 text-center">
            <button
              type="button"
              onClick={() => setShowAllRows(true)}
              className="text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              {`+ Show ${rows.length - 50} more rows`}
            </button>
          </div>
        ) : showAllRows && rows.length > 50 ? (
          <div className="border-t border-border bg-surface-popover/30 px-3 py-2 text-center">
            <button
              type="button"
              onClick={() => setShowAllRows(false)}
              className="text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              Show fewer rows
            </button>
          </div>
        ) : null}
        </div>
      </div>
    </div>
  )
}

interface CellInnerProps {
  value: number | null
  metric: ScaleMetric
  suffix?: string
  emoji?: string
  icon?: React.ReactNode
  decimals?: number
  tooltip?: string
}

function cellInner({ value, metric, suffix = '', emoji = '', icon, decimals = 0, tooltip }: CellInnerProps): CellResult {
  const display = value !== null
    ? (decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString())
    : '–'
  return {
    style: heatStyle(metric, value),
    node: (
      <span className="relative z-10 inline-flex items-center gap-0.5 justify-center" title={tooltip}>
        {icon ? icon : emoji && <span aria-hidden className="text-xs">{emoji}</span>}
        <span>{display}{suffix}</span>
      </span>
    ),
  }
}

/**
  * Memoised wrapper for a single Insights cell. We pass the raw props
  * (value, format, etc.) rather than a pre-built CellResult so React.memo
  * can compare the cell primitives and skip the re-render when nothing
  * actually changed. The radial-gradient inline style is only re-built
  * when (value, metric) changes, so the parent URL state changes don't
  * thrash the GPU with 200+ identical gradient strings.
  */
const HeatCell = memo(function HeatCell({
  node,
  style,
  hideOnCompact,
  extraClass,
}: {
  node: React.ReactNode
  style: React.CSSProperties | undefined
  hideOnCompact: boolean
  extraClass: string
}) {
  return (
    <td
      // Heat-cell text uses a CSS variable that flips between dark and
      // light text based on the html.light class. This makes it track the
      // theme toggle regardless of the OS `prefers-color-scheme` setting.
      className={`text-center px-1 py-1.5 font-mono tabular-nums text-[color:var(--heat-text)] ${extraClass} ${hideOnCompact ? 'hidden' : ''}`}
      style={style}
    >
      {node}
    </td>
  )
})

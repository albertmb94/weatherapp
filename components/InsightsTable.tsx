'use client'

import { useMemo, useState, useCallback, useRef, useEffect, memo } from 'react'
import type { WeatherModel } from '@/lib/models'
import { ENSEMBLE_PRESETS, METRIC_TO_ENSEMBLE, getLeadTimeBucket } from '@/lib/models'
import { getColor, SCALES } from '@/lib/colorScales'
import type { ScaleMetric } from '@/lib/colorScales'
import { weightedAvg } from '@/lib/ensemble'
import { resolveActiveModels, weightsFor } from '@/lib/ensemble/central'
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
  /** Full (untrimmed) time/series for bucket=24 to scan back to 00:00. */
  fullTimes?: Date[]
  fullSeries?: Record<string, Record<string, (number | null)[]>>
  /** Index in fullTimes of the current hour (used as iteration start for bucket=24). */
  startIndex?: number
  /** Number of days to show for bucket=24 (default 14). */
  weekDays?: 7 | 14
  showMarine?: boolean
  onMarineToggle?: () => void
  showBasic?: boolean
  onBasicToggle?: () => void
  ensembleMode?: 'wedai' | 'models'
  /** Sprint 10 / B-10-1: which ensemble mode to use for the *current
   *  hour* (the row the user has selected). Defaults to `'wedai'` so the
   *  active row's temperature matches the big "Tiempo actual" card and
   *  the "AHORA" slot of the hourly strip regardless of the user's
   *  `ensembleMode` toggle. Other rows still respect `ensembleMode`. */
  currentHourMode?: 'wedai' | 'models'
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
 *
 * Sprint 10 / B-10-6: the result is memoised per `(metric, value)`
 * tuple so a 336-row render produces at most one CSSProperties object
 * per unique (metric, value) pair instead of one per cell. For the
 * typical forecast this collapses ~4700 cell-instances to a few
 * dozen unique styles.
 */
const HEAT_STYLE_CACHE = new Map<string, React.CSSProperties>()
function heatStyle(metric: ScaleMetric, value: number | null): React.CSSProperties {
  if (value === null || value === undefined) {
    return TRANSPARENT_STYLE
  }
  const key = `${metric}|${value}`
  const cached = HEAT_STYLE_CACHE.get(key)
  if (cached) return cached
  const color = getColor(metric, value)
  const triple = rgbTriple(color)
  const intensity = intensityFor(metric, value) ?? 0.5
  // Capped alpha stops so a 14x14 cell grid paints quickly on slow
  // mobile GPUs while still showing the "soft glow" character.
  const core = Math.round(intensity * 45)   // 0..45% alpha at the very core
  const mid = Math.round(intensity * 18)    // 0..18% at the mid radius
  const style: React.CSSProperties = {
    ['--heat-rgb-triple' as string]: triple,
    background: `radial-gradient(ellipse 32% 60% at 50% 50%, rgba(${triple},${core}%) 0%, rgba(${triple},${mid}%) 50%, rgba(${triple},0) 92%)`,
  } as React.CSSProperties
  HEAT_STYLE_CACHE.set(key, style)
  return style
}

const TRANSPARENT_STYLE: React.CSSProperties = { background: 'transparent' }

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
  ensembleMode = 'models',
  fullTimes,
  fullSeries,
  startIndex = 0,
  weekDays = 14,
  /** Sprint 10 / B-10-1: which ensemble mode to use for the *current
   *  hour* (the row the user has selected). Defaults to `'wedai'` so the
   *  active row's temperature matches the big "Tiempo actual" card and
   *  the "AHORA" slot of the hourly strip regardless of the user's
   *  `ensembleMode` toggle. Other rows still respect `ensembleMode`. */
  currentHourMode = 'wedai',
}: InsightsTableProps) {
  const { locale } = useLocale()

  // In WedAI mode, use ALL models for ensemble computation
  // In Models mode, use only the user-selected models
  const allModels = useMemo(
    () => models.filter(m => m.id !== 'marine_global'),
    [models]
  )
  const activeModels = useMemo(
    () => ensembleMode === 'wedai'
      ? allModels
      : models.filter(m => activeModelIds.includes(m.id)),
    [models, activeModelIds, ensembleMode, allModels]
  )

  const [columnOrder, setColumnOrder] = useState<MetricCellId[]>(loadColumnOrder)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const [compact, setCompact] = useState(false)
  // Sprint 10 / B-10-7: paginated rendering, 48 rows per page. The
  // user reported that bucket=1 (336 rows) still caused noticeable
  // slowdowns on mobile even with `content-visibility: auto`. The
  // remaining cost is the React reconciliation per row + the inline
  // radial-gradient per cell, both of which still run for rows that
  // haven't yet been scrolled into view. Pagination at 48 rows keeps
  // the DOM bounded to ~672 cells per page (vs the previous ~4704),
  // which is fast on every device. The "next 48h" button at the
  // bottom of the table advances `currentPage` so the user can step
  // through the full horizon without ever mounting all 336 rows at
  // once. Bucket changes reset to page 0.
  const PAGE_SIZE = 48
  const [currentPage, setCurrentPage] = useState(0)
  const tableContainerRef = useRef<HTMLDivElement | null>(null)
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

  // Reset currentPage to 0 whenever the bucket changes so the user
  // always starts at the top of the new window.
  const prevBucketRef = useRef(bucket)
  useEffect(() => {
    if (prevBucketRef.current !== bucket) {
      setCurrentPage(0)
      prevBucketRef.current = bucket
    }
  }, [bucket])

  const isDefaultOrder = useMemo(
    () => columnOrder.every((id, i) => id === DEFAULT_ORDER[i]),
    [columnOrder]
  )

  const rows = useMemo<Row[]>(() => {
    // For bucket=24 use the full (untrimmed) arrays so min/max scans from 00:00.
    const tt = bucket === 24 && fullTimes?.length ? fullTimes : times
    const s = bucket === 24 && fullSeries ? fullSeries : series
    if (activeModels.length === 0 || tt.length === 0) return []
    // Sprint 10 / B-10-6: the previous 96 h cap on bucket=1 (4 days)
    // was a workaround for mobile paint cost. With `content-visibility:
    // auto` on each row (see <tr> below) the browser skips off-screen
    // rendering, so we can now expose the full forecast horizon the
    // user actually requested. The "show first 50 rows" pagination
    // is retained for fast first paint — the user expands it to see
    // every hour.
    const limit = Math.min(tt.length, maxHours)

    // Build per-metric, per-hour weight arrays.
    // WedAI mode: use ensemble presets (per-metric, per-horizon weights)
    // Models mode: use each model's static weight
    const modelIds = activeModels.map(m => m.id)
    const staticWeights = activeModels.map(m => m.weight)

    const getWeightsForMetricAndHour = (metric: string, hourIndex: number): number[] => {
      if (ensembleMode === 'models') return staticWeights
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
      // Iterate from startIndex until we have weekDays buckets or run out of data.
      const rem = startIndex % 24
      const toMidnight = rem === 0 ? 24 : 24 - rem
      for (let i = startIndex; i < Math.min(tt.length, startIndex + toMidnight + (weekDays - 1) * 24); i++) {
        // Detect day boundary from the actual Date at position i.
        const ti = tt[i]
        const dayKey = ti instanceof Date
          ? `${ti.getUTCFullYear()}-${ti.getUTCMonth()}-${ti.getUTCDate()}`
          : ''
        if (!current || dayKey !== currentKey) {
          // Scan backwards to 00:00 of this day so min/max captures
          // morning temperatures. Only scan if the back-index exists.
          let dayStart = i
          while (dayStart > 0) {
            const prev = tt[dayStart - 1]
            if (!(prev instanceof Date)) break
            const prevKey = `${prev.getUTCFullYear()}-${prev.getUTCMonth()}-${prev.getUTCDate()}`
            if (prevKey !== dayKey) break
            dayStart--
          }
          const labelT = tt[i] ?? tt[dayStart] ?? tt[startIndex]
          current = {
            label: labelT instanceof Date
              ? bucketLabel(labelT, labelT, bucket, locale, utcOffsetSeconds)
              : dayKey,
            startIdx: dayStart,
            endIdx: i,
            centerIdx: i,
            tempMean: null, tempMin: null, tempMax: null,
            cloudMean: null, windMean: null, windDirection: null, gustsMax: null, precipSum: null,
            humidityMean: null, uvIndexMean: null,
            pressureMean: null, dewpointMean: null, visibilityMean: null,
            ...emptyMarine,
            icon: 'sunny',
          }
          currentKey = dayKey
          buckets.push(current)
        }
        if (tt[i] instanceof Date) {
          current.endIdx = i
          if ((tt[i] as Date).getUTCHours() === 12) current.centerIdx = i
        }
      }
    // Truncate to weekDays so we never show more than requested.
    if (buckets.length > weekDays) buckets.splice(weekDays)
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
        const tVals = activeModels.map(m => s[m.id]?.['temperature']?.[i] ?? null)
        const tEns = weightedAvg(tVals, tWeights)
        if (tEns !== null) {
          tSum += tEns
          tCount += 1
          if (b.tempMin === null || tEns < b.tempMin) b.tempMin = tEns
          if (b.tempMax === null || tEns > b.tempMax) b.tempMax = tEns
        }
        const cWeights = getWeightsForMetricAndHour('cloud_cover', i)
        const cVals = activeModels.map(m => s[m.id]?.['cloud_cover']?.[i] ?? null)
        const cEns = weightedAvg(cVals, cWeights)
        if (cEns !== null) { cSum += cEns; cCount += 1 }
        const wWeights = getWeightsForMetricAndHour('wind_speed', i)
        const wVals = activeModels.map(m => s[m.id]?.['wind_speed']?.[i] ?? null)
        const wEns = weightedAvg(wVals, wWeights)
        if (wEns !== null) { wSum += wEns; wCount += 1 }
        const gWeights = getWeightsForMetricAndHour('wind_gusts', i)
        const gVals = activeModels.map(m => s[m.id]?.['wind_gusts']?.[i] ?? null)
        const gEns = weightedAvg(gVals, gWeights)
        if (gEns !== null && (b.gustsMax === null || gEns > b.gustsMax)) b.gustsMax = gEns
        const pWeights = getWeightsForMetricAndHour('precipitation', i)
        const pVals = activeModels.map(m => s[m.id]?.['precipitation']?.[i] ?? null)
        const pEns = weightedAvg(pVals, pWeights)
        if (pEns !== null) b.precipSum = (b.precipSum ?? 0) + pEns
        const hWeights = getWeightsForMetricAndHour('humidity', i)
        const hVals = activeModels.map(m => s[m.id]?.['humidity']?.[i] ?? null)
        const hEns = weightedAvg(hVals, hWeights)
        if (hEns !== null) { hSum += hEns; hCount += 1 }
        const uWeights = getWeightsForMetricAndHour('uv_index', i)
        const uVals = activeModels.map(m => s[m.id]?.['uv_index']?.[i] ?? null)
        const uEns = weightedAvg(uVals, uWeights)
        if (uEns !== null) { uSum += uEns; uCount += 1 }
        const prWeights = getWeightsForMetricAndHour('pressure', i)
        const prVals = activeModels.map(m => s[m.id]?.['pressure']?.[i] ?? null)
        const prEns = weightedAvg(prVals, prWeights)
        if (prEns !== null) { prSum += prEns; prCount += 1 }
        const dpWeights = getWeightsForMetricAndHour('dewpoint', i)
        const dpVals = activeModels.map(m => s[m.id]?.['dewpoint']?.[i] ?? null)
        const dpEns = weightedAvg(dpVals, dpWeights)
        if (dpEns !== null) { dpSum += dpEns; dpCount += 1 }
        const visWeights = getWeightsForMetricAndHour('visibility', i)
        const visVals = activeModels.map(m => {
          const v = s[m.id]?.['visibility']?.[i]
          return v !== null && v !== undefined ? v / 1000 : null
        })
        const visEns = weightedAvg(visVals, visWeights)
        if (visEns !== null) { visSum += visEns; visCount += 1 }
        const dirWeights = getWeightsForMetricAndHour('wind_direction', i)
        let hCos = 0, hSin = 0, hW = 0
        for (let j = 0; j < activeModels.length; j++) {
          const d = s[activeModels[j].id]?.['wind_direction']?.[i]
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
        const mSeries = s['marine_global']
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

    // Sprint 10 / B-10-1: the active row (the one covering the
    // currently selected hour) must show the same temperature the
    // big "Tiempo actual" card and the "AHORA" slot of the hourly
    // strip use. Those callers force `currentHourMode='wedai'`
    // regardless of the user's `ensembleMode` toggle, so the active
    // row's `tempMean` is recomputed here with the same model set
    // and weights. Other metrics (cloud, wind, min, max, ...) keep
    // their existing ensembleMode-based values so the row still
    // reads as a coherent daily summary.
    if (currentHourMode === 'wedai') {
      const wedaiModels = resolveActiveModels(models, activeModelIds, 'wedai')
      if (wedaiModels.length > 0) {
        // Use the same backing array the rest of the aggregation
        // loop used so index spaces match.
        const activeSeries = s as Record<string, Record<string, (number | null)[]>>
        // Compute the series length per-model (they're aligned) for
        // a defensive bounds check.
        const seriesLen = activeSeries[wedaiModels[0].id]?.['temperature']?.length ?? 0
        for (const b of buckets) {
          // selectedHour is in view-relative space; rows are built
          // over either `times` (trimmed) or `fullTimes` depending on
          // the bucket. We shift by startIndex for bucket=24 to align.
          const shiftedStart = bucket === 24 ? b.startIdx - startIndex : b.startIdx
          const shiftedEnd = bucket === 24 ? b.endIdx - startIndex : b.endIdx
          if (selectedHour < shiftedStart || selectedHour > shiftedEnd) continue
          const absIdx = bucket === 24 ? startIndex + selectedHour : selectedHour
          if (absIdx < 0 || absIdx >= seriesLen) continue
          // Use the central module so the formula matches
          // friendlyForecast.computeCurrentSnapshot byte-for-byte.
          const tWeights = weightsFor('temperature', absIdx, bucket, wedaiModels)
          const tVals = wedaiModels.map(
            m => activeSeries[m.id]?.['temperature']?.[absIdx] ?? null
          )
          const tEns = weightedAvg(tVals, tWeights)
          if (tEns !== null) {
            b.tempMean = tEns
            // For bucket=1 the row covers exactly one hour so
            // tempMin/tempMax must agree with the mean to avoid
            // contradicting the cell display.
            if (bucket === 1) {
              b.tempMin = tEns
              b.tempMax = tEns
            }
          }
          break // only one row is active
        }
      }
    }

    return buckets
  }, [activeModels, models, activeModelIds, currentHourMode, fullTimes, fullSeries, times, series, bucket, maxHours, locale, utcOffsetSeconds, startIndex, weekDays, selectedHour])

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

  // Sprint 10 / B-10-7: paginated rendering at 48 rows per page.
  // Clamp currentPage defensively so a stale state can never render
  // an out-of-bounds slice (e.g. after a bucket change that shrunk
  // the row count).
  const safePage = Math.min(currentPage, Math.max(0, Math.floor((rows.length - 1) / PAGE_SIZE)))
  const pageStart = safePage * PAGE_SIZE
  const pageEnd = Math.min(rows.length, pageStart + PAGE_SIZE)
  const visibleRows = rows.slice(pageStart, pageEnd)
  const visibleCellsByRow = cellsByRow.slice(pageStart, pageEnd)
  const hasNext = pageEnd < rows.length
  const hasPrev = safePage > 0
  const remaining = rows.length - pageEnd

  if (activeModels.length === 0) return null

  return (
    <div className="mb-4 animate-fadeIn">
      <div className="flex items-center gap-2 mb-3">
          <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold">
            {STRINGS[locale].insightsTitle}
            {(bucket === 1 || bucket === 2) && (
              // Sprint 10 / B-10-6: with content-visibility the table now
              // renders the full horizon (up to 14 days). The label
              // reflects the actual ceiling so the user knows how far
              // they can scroll.
              <span className="ml-2 normal-case tracking-normal font-normal text-text-muted">
                ({bucket === 1 ? 'Próximas 336h' : 'Próximas 168h'})
              </span>
            )}
          </h3>
          {/* Sprint 10 / B-10-7: page indicator for paginated buckets
              (1/2/6 h). Helps the user understand how many 48h
              "pages" remain without scrolling to the bottom CTA. */}
          {rows.length > PAGE_SIZE ? (
            <span className="ml-auto text-[10px] tabular-nums text-text-muted">
              {locale === 'en'
                ? `Page ${safePage + 1} / ${Math.ceil(rows.length / PAGE_SIZE)} · hours ${pageStart + 1}–${pageEnd}`
                : `Pág. ${safePage + 1} / ${Math.ceil(rows.length / PAGE_SIZE)} · horas ${pageStart + 1}–${pageEnd}`}
            </span>
          ) : null}
      </div>
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
        <div
          // Sprint 10 / B-10-7: vertical + horizontal scroll happen INSIDE
          // this container, so the sticky thead can actually do its job.
          // If we kept overflow-x-only on a tall table, sticky `top-0`
          // would never trigger (the scrolling context would be the
          // page, but the table extends past the viewport on a long
          // bucket=1 view). max-h keeps the headers within reach
          // without forcing a huge surface on devices that don't need
          // it.
          ref={tableContainerRef}
          className="overflow-auto max-h-[70vh] contain-[layout_style_paint]"
        >
          <table
            // Sprint 10 / B-10-8: switched from `border-separate` +
            // `border-spacing: 0` back to `border-collapse: collapse`.
            // The previous combo caused column-width drift when the
            // first column was sticky (its `w-[64px]` + the others'
            // auto-width broke the table layout on mobile landscape).
            // Modern browsers (Chrome 91+, Safari 14+) DO support
            // `position: sticky` on <th> with `border-collapse:
            // collapse`, so we get a stable layout AND sticky headers.
            // A <colgroup> pins the first column to 64 px so every
            // other column auto-sizes to the remaining width.
            className="w-full border-collapse table-fixed text-xs [&_th]:text-[11px] [&_td]:text-[11px] [&_span]:text-[11px]"
          >
            <colgroup>
              <col style={{ width: '64px' }} data-col-id="__when__" />
              {colDefs.map((col, idx) => (
                <col
                  key={col.id}
                  data-col-id={col.id}
                  // Marine columns are wider because they display
                  // units (m, s, °); the rest auto-size to 1fr.
                  //
                  // B-NEW-2: applying `hideClass` to the <col> element
                  // too is critical — `table-fixed` lays out columns
                  // from the <colgroup>, so a hidden column with no
                  // explicit width otherwise still claims a slice of the
                  // container width. That left the visible columns
                  // clustered to the left of the screen with empty
                  // space on the right (the user reported the table
                  // looked "collapsed to the left"). `display: none`
                  // on the <col> collapses the column, so the visible
                  // columns redistribute over the full container width.
                  className={col.hideClass}
                  style={{ width: col.id.startsWith('wave_') || col.id === 'sea_surface_temperature' ? '64px' : undefined }}
                />
              ))}
            </colgroup>
          <thead className="bg-surface sticky top-0 z-30">
            <tr className="bg-surface text-text-secondary">
              <th
                style={{ background: 'var(--surface)' }}
                // Sprint 10 / B-10-8: the first column header is now
                // BOTH sticky on the left AND on the top, with a
                // higher z-index than the rest of the header so it
                // sits above the thead when the user scrolls either
                // direction. The `shadow-[2px_0_4px_rgba(0,0,0,0.5)]`
                // renders a vertical divider on the right edge so the
                // user can tell the column is sticky.
                className="sticky left-0 top-0 z-40 text-center px-1.5 py-1.5 font-medium border-b border-border-r border-border/60 shadow-[2px_0_4px_rgba(0,0,0,0.5)]"
              >
                {STRINGS[locale].tableWhen}
              </th>
              {colDefs.map((col, idx) => {
                const dragClass = idx === dragIdx ? 'opacity-40' : idx === overIdx && dragIdx !== null && idx !== dragIdx ? 'border-t-2 border-t-accent' : ''
                return (
                  <th
                    key={col.id}
                    data-col-id={col.id}
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
            {hasPrev ? (
              <tr
                // Sprint 10 / B-10-7: navigation back to the previous
                // page. Sits at the TOP of the visible rows so the user
                // doesn't have to scroll up through the previous page
                // first. The container scrolls to top so the new page
                // starts under the sticky headers.
                key="__prev-page-cta__"
                role="button"
                tabIndex={0}
                onClick={() => {
                  setCurrentPage(p => Math.max(0, p - 1))
                  requestAnimationFrame(() => {
                    // Guard against jsdom / browsers that don't
                    // implement scrollTo on a generic element (the
                    // feature was added later than the underlying
                    // scroll behaviour). Real browsers always have it.
                    const el = tableContainerRef.current
                    if (el && typeof el.scrollTo === 'function') {
                      el.scrollTo({ top: 0, behavior: 'smooth' })
                    }
                  })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setCurrentPage(p => Math.max(0, p - 1))
                    requestAnimationFrame(() => {
                      const el = tableContainerRef.current
                      if (el && typeof el.scrollTo === 'function') {
                        el.scrollTo({ top: 0, behavior: 'smooth' })
                      }
                    })
                  }
                }}
                aria-label="Previous 48 hours"
                className="cursor-pointer bg-surface-popover/40 hover:bg-accent/10 transition-colors focus-visible:bg-accent/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                data-testid="prev-page-cta"
              >
                <td
                  colSpan={colDefs.length + 1}
                  className="text-center px-2 py-2 text-[11px] text-text-secondary tabular-nums border-b border-border"
                >
                  <span className="font-semibold text-accent">
                    {locale === 'en' ? '← Previous 48 h' : '← 48 h anteriores'}
                  </span>
                </td>
              </tr>
            ) : null}
            {visibleRows.map((r, i) => {
              // selectedHour is view-relative; rows are built over the
              // trimmed `times` series (i.e. view-relative too) except in
              // the bucket=24 branch where they were originally computed
              // using fullTimes. Shift by startIndex to align.
              const shiftedStart = bucket === 24 ? r.startIdx - startIndex : r.startIdx
              const shiftedEnd = bucket === 24 ? r.endIdx - startIndex : r.endIdx
              const isActive = selectedHour >= shiftedStart && selectedHour <= shiftedEnd
              const zebra = (pageStart + i) % 2 === 1
              const whenBg = isActive
                ? 'bg-accent-soft/70 ring-1 ring-inset ring-accent/40'
                : zebra
                  ? 'bg-surface-raised/30'
                  : 'bg-transparent'
              const rowCells = visibleCellsByRow[i] ?? []
              return (
                <tr
                  key={i}
                  onClick={() => onSelectHour(r.centerIdx - startIndex)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectHour(r.centerIdx - startIndex)
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={r.label}
                  // Sprint 10 / B-10-6: `content-visibility: auto` +
                  // `contain-intrinsic-size: auto 28px` lets the
                  // browser skip painting rows that are off-screen.
                  // That collapses the cost of a 336-row (14 days
                  // × 24 h) bucket=1 render to roughly the cost of
                  // the rows actually visible in the viewport — the
                  // intrinsic-size keeps scrollbar height honest
                  // without forcing layout of the contents.
                  style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 28px' }}
                  className="cursor-pointer transition-colors hover:[&>td]:bg-accent/10 contain-[layout_style_paint] focus-visible:bg-accent/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  <td
                    style={{ background: 'var(--surface)' }}
                    // Sprint 10 / B-10-8: `sticky left-0 z-40` (raised
                    // from z-30) so the first-column data cell stays
                    // above the other cells AND above the thead when
                    // both axes scroll. Matches the first-column <th>
                    // z-index.
                    className={`sticky left-0 z-40 px-1.5 py-1.5 ${showMarine ? 'whitespace-nowrap' : 'whitespace-normal'} text-text-primary border-b border-border-r border-border/60 shadow-[2px_0_4px_rgba(0,0,0,0.5)] tabular-nums ${whenBg}`}
                  >
                    {/* Sprint 10 / B-10-2: when bucket=24 and the user is
                       on the actual current hour (selectedHour === 0),
                       the active row's tempMean is the CURRENT hour's
                       temperature (B-10-1 forced WedAI for the current
                       hour). The chip clarifies that so the user
                       doesn't read it as a daily average. For any
                       other selectedHour (e.g. tomorrow) we do not
                       show "Ahora" — the value is a forecast for that
                       future hour. */}
                    {isActive && bucket === 24 && selectedHour === 0 && r.tempMean !== null ? (
                      <div
                        className="text-[9px] uppercase tracking-wider font-semibold text-accent mb-0.5 leading-tight"
                        aria-label="Hora actual"
                        data-testid="ahora-chip"
                      >
                        ↳ Ahora · {Math.round(r.tempMean)}°
                      </div>
                    ) : null}
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
            {hasNext ? (
              <tr
                // Sprint 10 / B-10-7: the last row IS the pagination
                // control. Clicking advances currentPage so the next
                // PAGE_SIZE rows mount; the container scrolls back to
                // the top so the headers stay in view.
                key="__next-page-cta__"
                role="button"
                tabIndex={0}
                onClick={() => {
                  setCurrentPage(p => p + 1)
                  // Bring the user back to the top of the table
                  // container so the new page starts under the
                  // sticky headers instead of mid-scroll.
                  requestAnimationFrame(() => {
                    const el = tableContainerRef.current
                    if (el && typeof el.scrollTo === 'function') {
                      el.scrollTo({ top: 0, behavior: 'smooth' })
                    }
                  })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setCurrentPage(p => p + 1)
                    requestAnimationFrame(() => {
                      const el = tableContainerRef.current
                      if (el && typeof el.scrollTo === 'function') {
                        el.scrollTo({ top: 0, behavior: 'smooth' })
                      }
                    })
                  }
                }}
                aria-label={
                  locale === 'en'
                    ? `Show next ${Math.min(PAGE_SIZE, remaining)} hours`
                    : `Mostrar siguientes ${Math.min(PAGE_SIZE, remaining)} horas`
                }
                className="cursor-pointer bg-surface-popover/40 hover:bg-accent/10 transition-colors focus-visible:bg-accent/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                data-testid="next-page-cta"
              >
                <td
                  colSpan={colDefs.length + 1}
                  className="text-center px-2 py-3 text-[11px] text-text-secondary tabular-nums border-t border-border"
                >
                  <span className="font-semibold text-accent">
                    {STRINGS[locale].insightsShowNext.replace('{n}', String(Math.min(PAGE_SIZE, remaining)))}
                  </span>
                  <span className="ml-2 text-text-muted">
                    {STRINGS[locale].insightsRowsRemaining.replace('{n}', String(remaining))}
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
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
      //
      // Sprint 10 / B-10-6: `contain: layout style paint` makes each
      // cell an independent paint island so a change to one cell
      // (e.g. the active-row ring) cannot trigger a repaint of any
      // sibling. Combined with content-visibility on the row, this
      // lets the browser aggressively skip work for off-screen rows.
      // Sprint 10 / B-10-8: removed `sm:text-[color:var(--heat-text)]`
      // because it triggered white text in landscape mobile (width ≥
      // 640 px → sm: breakpoint) on dark mode. The user expects black
      // text consistently; `text-black` is unconditional so the cell
      // text reads the same on every viewport size.
      className={`text-center px-1 py-1.5 font-mono tabular-nums text-black ${extraClass} ${hideOnCompact ? 'hidden' : ''} [contain:layout_style_paint]`}
      style={style}
    >
      {node}
    </td>
  )
})

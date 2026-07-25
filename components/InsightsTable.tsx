'use client'

import { useMemo, useState, useCallback, useRef, useEffect, memo } from 'react'
import type { WeatherModel } from '@/lib/models'
import { ENSEMBLE_PRESETS, METRIC_TO_ENSEMBLE, getLeadTimeBucket } from '@/lib/models'
import { getColor, SCALES } from '@/lib/colorScales'
import type { ScaleMetric } from '@/lib/colorScales'
import { weightedAvg } from '@/lib/ensemble'
import { resolveActiveModels, weightsFor, ensembleWithFallback } from '@/lib/ensemble/central'
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
  //
  // B-NEW-7 (2026-07-24): the gradient size now reads from the
  // `--heat-cell-bg-size` CSS custom property defined in
  // app/globals.css. On desktop (>= 640 px) it is the original
  // 32%×60% narrow ellipse (the user explicitly asked to
  // restore the "soft glow that doesn't reach the cell border"
  // character). On mobile (< 640 px) it widens to 95%×95% so
  // the colour reaches the cell border — the narrow gradient
  // left a transparent margin around narrow cells, which on
  // the UV column read as "the data is split in two halves"
  // (the value "5.8" extended past the coloured band and
  // rendered with its left/right portions on the transparent
  // cell background). The radial falloff still gives a "soft
  // glow" feel; the only difference is that on mobile the
  // outer edge is solid colour instead of transparent.
  //
  // B-NEW-13 (2026-07-26): reverted. The user explicitly asked
  // to keep the original desktop gradient (the soft-glow character
  // they had approved in B-NEW-7). The previous tint that
  // filled the transparent margins changed the look on
  // desktop — they noticed and asked for it back. The
  // "seam between cells" the tint was originally masking is
  // now back, but on mobile the existing CSS rule
  // (`[style*='--heat-rgb-triple'] { background: rgb(...) }`)
  // still overrides the gradient to a solid colour, so the
  // mobile "border mid-UV" issue from the previous bug
  // report is no longer relevant — it's a desktop-only
  // visual choice now.
  const core = Math.round(intensity * 45)   // 0..45% alpha at the very core
  const mid = Math.round(intensity * 18)    // 0..18% at the mid radius
  const style: React.CSSProperties = {
    ['--heat-rgb-triple' as string]: triple,
    background: `radial-gradient(ellipse var(--heat-cell-bg-size, 32% 60%) at 50% 50%, rgba(${triple},${core}%) 0%, rgba(${triple},${mid})% 50%, rgba(${triple},0) 92%)`,
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

function cellData(id: MetricCellId, r: Row, bucket: BucketHours): CellResult {
  // B-NEW-15 (2026-07-26): revert the 1-decimal per-hour
  // rendering the user introduced in B-NEW-9. The user
  // reports that with `decimals: 1` the temperature strings
  // (`26.6°`, `27.8°`, `24.2°`) are 4-5 chars wide and
  // overflow the basic 1h/2h/6h/12h columns (which are
  // ~30-50 px wide on mobile portrait and ~50-60 px on desktop
  // when marine is also on), causing visible text overlap with
  // the neighbouring cell. We now render every temperature
  // column (temp / min / max) with 0 decimals regardless of
  // bucket — `Math.round(value).toString()` produces 1-3 char
  // strings (`27°`, `31°`, `-2°`) that fit cleanly in any
  // column. The user is comfortable relying on the row-hover
  // indicator (the cell glows accent/10) and the row label
  // ("Hoy 14:00", "Mañ 00:00") to disambiguate rows visually;
  // they don't need the sub-degree precision on the per-hour
  // view.
  switch (id) {
    case 'cond':
      return { node: <span className="inline-flex items-center justify-center"><WeatherConditionIcon icon={r.icon} size="sm" /></span> }
    case 'temp':
      return cellInner({
        value: r.tempMean,
         metric: 'temperature',
         suffix: '°',
         decimals: 0,
       })
    case 'min':
      return cellInner({
        value: r.tempMin,
        metric: 'temperature',
        suffix: '°',
        decimals: 0,
      })
    case 'max':
      return cellInner({
        value: r.tempMax,
        metric: 'temperature',
        suffix: '°',
        decimals: 0,
      })
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
      return cellInner({ value: r.waveDirection, metric: 'wave_direction', suffix: '°', decimals: 0, icon: <WindArrow degrees={r.waveDirection} />, tooltip: r.windDirection !== null ? `${Math.round(r.windDirection)}°` : undefined })
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

  // B-NEW-9 (2026-07-24, hotfix over 808752d): WedAI is ALWAYS the
  // full calibrated ensemble, regardless of what the user has
  // selected in the Models dropdown. The Models dropdown only
  // affects Models mode. This is the product design: WedAI is
  // the "best estimate" derived from backtesting every model
  // we have; the user's selection is for "show me what these N
  // models think", which is a different question.
  //
  // The previous commit (808752d) collapsed both modes into
  // `models.filter(m => activeModelIds.includes(m.id))`, which
  // meant WedAI behaved exactly like the Models selection — the
  // user correctly reported "WedAI se comporta exactamente igual
  // que los modelos, filtrando por el modelo filtrado por el
  // usuario, cuando debería comportarse como un ensemble en si
  // mismo". The reverted design re-anchors WedAI on `allModels`
  // (the 19 land models) and re-applies the preset weights from
  // `ENSEMBLE_PRESETS` in `getWeightsForMetricAndHour`.
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
  // B-NEW-3 (mobile): tracks whether the table container has hidden
  // content to the left / right, so the gradient masks can render
  // only on the side that has more to scroll. We start with both
  // false (table fits) and let the onScroll handler update them.
  const [scrollState, setScrollState] = useState<{ left: boolean; right: boolean }>({ left: false, right: false })
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
      // B-NEW-6: pre-compute the WedAI fallback set once per bucket.
      // When the user has selected a short-range model that the
      // production API doesn't include (see B-NEW-3 in
      // lib/openMeteo.ts), every per-hour ensemble returns null
      // and the user sees a table full of em-dashes. The fallback
      // re-runs the same mean against the full land-model set so
      // the user always sees a value when at least one model has
      // data. The WedAI models exclude `marine_global` (which is
      // a virtual model with no land data).
      const wedaiModels = allModels
      // B-NEW-9 (2026-07-24): the per-row temperature spread. For
      for (let i = b.startIdx; i <= b.endIdx; i++) {
        // Use per-metric, per-hour weights for proper ensemble selection
        const tWeights = getWeightsForMetricAndHour('temperature', i)
        const tEns = ensembleWithFallback(s, 'temperature', i, activeModels, wedaiModels, tWeights)
        if (tEns !== null) {
          tSum += tEns
          tCount += 1
          if (b.tempMin === null || tEns < b.tempMin) b.tempMin = tEns
          if (b.tempMax === null || tEns > b.tempMax) b.tempMax = tEns
        }
        const cWeights = getWeightsForMetricAndHour('cloud_cover', i)
        const cEns = ensembleWithFallback(s, 'cloud_cover', i, activeModels, wedaiModels, cWeights)
        if (cEns !== null) { cSum += cEns; cCount += 1 }
        const wWeights = getWeightsForMetricAndHour('wind_speed', i)
        const wEns = ensembleWithFallback(s, 'wind_speed', i, activeModels, wedaiModels, wWeights)
        if (wEns !== null) { wSum += wEns; wCount += 1 }
        const gWeights = getWeightsForMetricAndHour('wind_gusts', i)
        const gEns = ensembleWithFallback(s, 'wind_gusts', i, activeModels, wedaiModels, gWeights)
        if (gEns !== null && (b.gustsMax === null || gEns > b.gustsMax)) b.gustsMax = gEns
        const pWeights = getWeightsForMetricAndHour('precipitation', i)
        const pEns = ensembleWithFallback(s, 'precipitation', i, activeModels, wedaiModels, pWeights)
        if (pEns !== null) b.precipSum = (b.precipSum ?? 0) + pEns
        const hWeights = getWeightsForMetricAndHour('humidity', i)
        const hEns = ensembleWithFallback(s, 'humidity', i, activeModels, wedaiModels, hWeights)
        if (hEns !== null) { hSum += hEns; hCount += 1 }
        const uWeights = getWeightsForMetricAndHour('uv_index', i)
        const uEns = ensembleWithFallback(s, 'uv_index', i, activeModels, wedaiModels, uWeights)
        if (uEns !== null) { uSum += uEns; uCount += 1 }
        const prWeights = getWeightsForMetricAndHour('pressure', i)
        const prEns = ensembleWithFallback(s, 'pressure', i, activeModels, wedaiModels, prWeights)
        if (prEns !== null) { prSum += prEns; prCount += 1 }
        const dpWeights = getWeightsForMetricAndHour('dewpoint', i)
        const dpEns = ensembleWithFallback(s, 'dewpoint', i, activeModels, wedaiModels, dpWeights)
        if (dpEns !== null) { dpSum += dpEns; dpCount += 1 }
        const visWeights = getWeightsForMetricAndHour('visibility', i)
        // Visibility is reported in metres; convert to km once here so
        // every consumer (table, CSV, map) reads the same unit.
        const visValsForFallback = activeModels.map(m => {
          const v = s[m.id]?.['visibility']?.[i]
          return v !== null && v !== undefined ? v / 1000 : null
        })
        const visEns = weightedAvg(visValsForFallback, visWeights)
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

  // B-NEW-16 (2026-07-26): on a phone in portrait orientation,
  // when the user turns Marine on, the table would otherwise
  // need horizontal scrolling to fit all 14 columns (cond,
  // temp, wind, precip, humidity, uv + 8 marine). The user
  // explicitly asked to surface only the key columns on
  // mobile portrait to avoid the scroll: Temp °C, Wind km/h,
  // Lluvia mm, Mar °C (sea_surface_temperature), Ola m
  // (wave_height). On landscape phones the width is enough
  // for the full view, so we keep the default behaviour.
  //
  // SSR initial state is `false` so the server-rendered HTML
  // contains every column (no hydration mismatch). The
  // `useEffect` upgrades to `true` on the client when the
  // viewport matches the media query, and re-renders the
  // table with the filtered columns. There is a brief flash
  // of the unfiltered table on first paint (acceptable
  // trade-off vs. introducing a SSR-side viewport-detection
  // heuristic that would have to mirror the client).
  const [isMobilePortrait, setIsMobilePortrait] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 767px) and (orientation: portrait)')
    const update = (e: MediaQueryListEvent | MediaQueryList) => setIsMobilePortrait(e.matches)
    update(mq)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const MOBILE_PORTRAIT_KEY_COLS = useMemo(
    () => new Set<MetricCellId>([
      'temp', 'wind', 'precip',
      'sea_surface_temperature', 'wave_height',
    ]),
    []
  )

  const visibleIds = useMemo(
    () => columnOrder.filter(id => {
      // B-NEW-16: mobile-portrait + marine collapses to the
      // 5 key columns. The user wants Temp °C / Viento km/h /
      // Lluvia mm / Mar °C / Ola m in this mode (the basic
      // icon column and humidity/uv are hidden because they
      // add horizontal scroll with no extra value on a phone).
      if (showMarine && isMobilePortrait) {
        return MOBILE_PORTRAIT_KEY_COLS.has(id)
      }
      if (!showMarine && marineColIds.has(id)) return false
      if (showMarine && !showBasic && !marineColIds.has(id)) return false
      return true
    }),
    [columnOrder, showMarine, showBasic, isMobilePortrait, marineColIds, MOBILE_PORTRAIT_KEY_COLS]
  )
  const colDefs = useMemo(
    () => visibleIds.map(id => METRIC_COLUMNS.find(c => c.id === id)!),
    [visibleIds]
  )

  // Pre-compute each row's cells once. Without this, the cellData() switch
  // is invoked 14 cols x 14 rows = 196 times per render even when the
  // table itself is not in the active viewport. The `bucket` argument
  // is forwarded so `cellData` can pick the right display precision
  // (1 decimal on per-hour buckets so individual model differences
  // are visible, 0 on the day card so "31°" reads clean).
  const cellsByRow = useMemo(() => {
    const result: CellResult[][] = []
    for (const r of rows) {
      const row: CellResult[] = []
      for (const col of colDefs) {
        row.push(cellData(col.id, r, bucket))
      }
      result.push(row)
    }
    return result
  }, [rows, colDefs, bucket])

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
              // Sprint 10 / B-10-6 + B-NEW-3: with content-visibility
              // the table now renders the full horizon (up to 14
              // days). The label reflects the actual row count so the
              // user knows how far they can scroll — the previous
              // hardcoded "Próximas 336h" was wrong whenever the data
              // span was anything else (e.g. 168h when only 7 days of
              // valid series are available).
              <span className="ml-2 normal-case tracking-normal font-normal text-text-muted">
                ({locale === 'en'
                  ? `Next ${rows.length}h`
                  : `Próximas ${rows.length}h`})
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
          //
          // B-NEW-3 (mobile): a gradient mask on the right edge
          // signals there's more content to the right. Phone-width
          // tables overflow horizontally once the marine columns
          // (each 64 px) or the 6-column basic view push past the
          // 360 px viewport, and the user reported the table looked
          // "completely broken" without a hint that scrolling was
          // possible.
          ref={tableContainerRef}
          onScroll={(e) => {
            const el = e.currentTarget
            setScrollState({
              left: el.scrollLeft > 4,
              right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
            })
          }}
          className="relative overflow-auto max-h-[70vh] contain-[layout_style_paint]"
        >
          {/* Mobile-only scroll hint: fades in on whichever side has
              more content. Hidden on >=sm where the table fits. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-surface-raised to-transparent z-20 sm:hidden"
            style={{ opacity: scrollState.left ? 1 : 0, transition: 'opacity 120ms' }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-4 bg-gradient-to-l from-surface-raised to-transparent z-20 sm:hidden"
            style={{ opacity: scrollState.right ? 1 : 0, transition: 'opacity 120ms' }}
          />
          <table
            // Sprint 10 / B-10-8: switched from `border-separate` +
            // `border-spacing: 0` back to `border-collapse: collapse`.
            // The previous combo caused column-width drift when the
            // first column was sticky (its `w-[64px]` + the others'
            // auto-width broke the table layout on mobile landscape).
            // Modern browsers (Chrome 91+, Safari 14+) DO support
            // `position: sticky` on <th> with `border-collapse:
            // collapse`, so we get a stable layout AND sticky headers.
            //
            // B-NEW-5 (2026-07-24): removed `table-fixed` because it
            // forced every `width: auto` <col> to share the REMAINING
            // width equally, which made the 1h/2h/6h columns too
            // narrow on a 360-px phone (the basic 6-column view
            // squeezed to ~51 px per column) and made the landscape
            // view look "collapsed to the right" (the table was
            // wider than the viewport but every column was the same
            // width, so the user could only see the right half
            // after scrolling). With the default `table-auto` each
            // column now sizes to the widest CELL in that column —
            // short numeric columns like temp/wind/precip end up
            // narrower (more room for the wider ones), the table is
            // its natural width, and the container's
            // `overflow-x-auto` (set on the parent <div>) takes over
            // when the natural width exceeds the viewport. The
            // first column stays at 52 / 64 px via the CSS variable
            // on its <col>, and the `min-w-[36px]` sm:min-w-[44px] on
            // the data cells (below) prevents any single column from
            // collapsing to nothing.
            //
            // B-NEW-12 (2026-07-25): restore `table-fixed` ONLY on
            // md+ (desktop) so the table fills its container width
            // when Marine is on. With `table-auto` the basic
            // columns auto-size to their content (~35-45 px each)
            // and the marine columns are 40 px each, so the total
            // table width on desktop is well below the container
            // width and there's an empty band of background on the
            // right (the user described it as "sobra espacio por la
            // derecha"). With `table-fixed` the explicit-width
            // columns (sticky + marine) keep their size and the
            // remaining `width: auto` basic columns share the rest
            // of the row, filling the container. We keep
            // `table-auto` below md because on a 360-px phone the
            // explicit-width marine columns already exceed the
            // available width (8 × 40 = 320 px), and forcing them
            // through `table-fixed` would shrink the basic columns
            // to negative widths — that was the original B-NEW-5
            // regression. On mobile we let `table-auto` size to
            // content and `overflow-x-auto` scroll.
            //
            // B-NEW-17 (2026-07-27): switch the breakpoint from
            // `md:` (>=768 px) to `lg:` (>=1024 px). On a phone in
            // landscape (~800×400) the previous `md:table-fixed`
            // kicked in and shrank every basic column to ~32 px —
            // the cell content (a number like `27.8°` plus the °
            // suffix, ~33 px wide) overflowed the cell and bled
            // into the next column. The user explicitly asked to
            // "respect the values inside" the cells. By moving
            // `table-fixed` up to `lg:`, mobile landscape (768-
            // 1023 px) stays on `table-auto` so columns size to
            // their widest content, the longest marine value
            // `27.8°` (5 chars at 11 px font-mono ≈ 33 px) fits
            // cleanly in the now-48-px-wide marine column, and
            // there's no overflow into the next cell. Desktop
            // (>=1024 px) keeps the fill-the-container behaviour.
            className="w-full border-collapse text-xs lg:table-fixed [&_th]:text-[11px] [&_td]:text-[11px] [&_span]:text-[11px]"
          >
            <colgroup>
              {/* B-NEW-4 (mobile): the "Cuándo" column drops to
                  52 px below the sm breakpoint so the basic
                  6-column view fits inside ~360 px without forcing
                  the user to scroll on a 360-px phone. The label
                  "Mañ 00:00" / "Hoy 11:00" still fits at 11 px in
                  52 px (the longest label "Dom 26 00:00" is
                  ~52 px wide with `tabular-nums` and
                  `whitespace-nowrap` on the data cell). On >=sm
                  we keep the 64 px so the weekday + day + hour
                  combination reads comfortably.

                  We use a CSS custom property + a media query
                  rather than a Tailwind responsive class because
                  `<col>` elements have inconsistent support for
                  arbitrary `sm:` / `md:` variants across browsers
                  (the width attribute and the CSS property
                  collide). The custom property approach is
                  well-defined. */}
              <col
                data-col-id="__when__"
                style={{
                  width: 'var(--when-col-w, 64px)',
                }}
              />
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
                  //
                  // B-NEW-3 / B-NEW-4 (mobile): the marine columns
                  // used to be a fixed 64 px which alone exceeded a
                  // 360-px phone viewport (8 marine cols × 64 = 512
                  // px before the first column or any other data
                  // column is drawn). We dropped to 40 px (still
                  // enough for "0.3m" / "73°" at 11 px with the
                  // cell's `px-1` padding) and the right-edge
                  // scroll-fade mask gives a hint that more content
                  // is to the right. On desktop the 40 px is
                  // visually tighter than the 64 px it replaces
                  // but the units ("m", "s", "°") still read
                  // clearly because the basic 6-column view has
                  // more horizontal room to spare.
                  //
                  // B-NEW-11 (2026-07-25): also set `visibility:
                  // collapse` for columns that the CSS actually
                  // hides at the current viewport — i.e. the
                  // breakpoint-based `hideClass` values like
                  // `hidden sm:table-cell landscape:table-cell`
                  // (min/max/clouds/gusts) and `hidden
                  // xl:table-cell` (pressure/dewpoint/visibility).
                  // Tailwind's `display: none` (via `hidden`) on a
                  // `<col>` does not reliably collapse the column
                  // width under `table-layout: auto`, so on the
                  // viewports where those columns should be hidden
                  // they kept taking up horizontal space and created
                  // a visible gap at the basic→marine boundary —
                  // the user reported this as "a border separator
                  // after the UV column". `visibility: collapse`
                  // is the W3C-recommended way to hide table
                  // columns and works regardless of `table-layout`.
                  //
                  // IMPORTANT: only apply `visibility: collapse`
                  // when the hideClass actually hides the column
                  // (i.e. contains the `hidden` utility). Marine
                  // columns have `hideClass: 'marine-col'` as a
                  // pure marker — there's no CSS rule that hides
                  // them, they are excluded from `visibleIds` when
                  // `showMarine` is false — so collapsing them
                  // here would hide them even when the user has
                  // explicitly turned Marine ON. That was the
                  // root cause of "Marine on + Basic off = empty
                  // table" on the previous B-NEW-11 push.
                  className={col.hideClass}
                  style={{
                    // B-NEW-17 (2026-07-27): 48 px (was 40 px).
                    // The longest marine value is `27.8°` (5 chars
                    // at 11 px font-mono ≈ 33 px of text). With
                    // `px-1.5` on mobile (6 px each side = 12 px
                    // padding) the cell content area needs to be at
                    // least 33 + 12 = 45 px. 48 px gives 36 px of
                    // content room with 6 px breathing room either
                    // side so the text never overflows and bleeds
                    // into the next column (which is what the user
                    // reported as "ligero overlap" on mobile
                    // landscape). At sm+ the padding shrinks to
                    // `px-1` (4 px each side = 8 px) so 40 px would
                    // already fit, but we keep 48 px for visual
                    // consistency across viewports.
                    width: col.id.startsWith('wave_') || col.id === 'sea_surface_temperature' ? '48px' : undefined,
                    ...(col.hideClass && /\bhidden\b/.test(col.hideClass) ? { visibility: 'collapse' as const } : {}),
                  }}
                />
              ))}
            </colgroup>
          <thead className="bg-surface sticky top-0 z-30">
            <tr className="bg-surface text-text-secondary">
              <th
                style={{ background: 'var(--surface)' }}
                // Sprint 10 / B-10-8 + B-NEW-3: the first column header
                // is BOTH sticky on the left AND on the top, with a
                // higher z-index than the rest of the header so it
                // sits above the thead when the user scrolls either
                // direction. The z-50/z-40 split between the first
                // column header (z-50) and the first column body cell
                // (z-40) is critical: at the same z-index, the body
                // cell paints on top of the header because it comes
                // later in the DOM, so the "Hoy 10:00" / "Mañ 00:00"
                // text would scroll over the "Cuándo" header label.
                // The shadow on the right edge renders a vertical
                // divider so the user can tell the column is sticky.
                className="sticky left-0 top-0 z-50 text-center px-1.5 py-1.5 font-medium border-b border-border-r border-border/60 shadow-[2px_0_4px_rgba(0,0,0,0.5)]"
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
                    // B-NEW-3: the rest of the thead gets z-40 so it
                    // sits above the first-column body cell (z-30).
                    // Without this, scrolling vertically on a phone
                    // (where the body cell sticks to the left) lets
                    // the day/hour text bleed over the other column
                    // headers.
                    className={`sticky top-0 z-40 bg-surface text-center px-1 py-1.5 font-medium border-b border-border cursor-grab active:cursor-grabbing select-none tabular-nums text-text-secondary ${col.hideClass ?? ''} ${compact && COMPACT_HIDDEN_COLS.has(col.id) ? 'hidden' : ''} ${dragClass}`}
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
                    // Sprint 10 / B-10-8 + B-NEW-3: `sticky left-0 z-30`
                    // keeps the first-column data cell above the other
                    // body cells (so it stays visible when the user
                    // scrolls horizontally) but BELOW both header tiers
                    // (z-40 / z-50). The previous z-40 put the body
                    // cell at the same level as the first-column <th>,
                    // and because the <td> comes later in the DOM it
                    // painted on top of the header — the day/hour text
                    // overlapped the "Cuándo" label on mobile.
                    //
                    // B-NEW-5 (2026-07-24): dropped z-30 to z-20 so
                    // the body cell is strictly BELOW the thead
                    // (z-30) in the table stacking context. With
                    // z-30 on both the thead and the first-col td,
                    // DOM order was breaking the tie (the <td> comes
                    // after the <thead>) and the "Hoy 12:00" /
                    // "Mañ 00:00" text painted on top of the
                    // "Cuándo" header — most visible in landscape
                    // with marine on, where the first column was
                    // wider and the body text visibly overpainted
                    // the header. With z-20 the body cell stays
                    // visible above the OTHER body cells (which are
                    // z-auto) but never rises into the header's
                    // z-30 band, so the "Cuándo" label reads
                    // cleanly even when scrolled.
                    className={`sticky left-0 z-20 px-1.5 py-1.5 ${showMarine ? 'whitespace-nowrap' : 'whitespace-normal'} text-text-primary border-b border-border-r border-border/60 shadow-[2px_0_4px_rgba(0,0,0,0.5)] tabular-nums ${whenBg}`}
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
      // Sprint 10 / B-10-6: `contain: layout style paint` makes each
      // cell an independent paint island so a change to one cell
      // (e.g. the active-row ring) cannot trigger a repaint of any
      // sibling. Combined with content-visibility on the row, this
      // lets the browser aggressively skip work for off-screen rows.
      //
      // B-NEW-5 (text color): the colour now comes from the
      // `--heat-cell-text` CSS custom property defined in
      // `app/globals.css`. The resolution is unambiguous:
      //   - light theme (html.light)        → black
      //   - dark theme, portrait            → black
      //   - dark theme, landscape           → white
      // We avoid Tailwind's `dark:` variant entirely because this
      // app uses `html.light` for light mode and never sets a
      // `.dark` class, so the variant fires inconsistently across
      // browser versions. The CSS variable is a single source of
      // truth and works in every browser that supports custom
      // properties (which is the same set that supports the rest
      // of our design-token system).
      //
      // B-NEW-3 (mobile): `px-1.5 sm:px-1` trims horizontal padding
      // on phone-width viewports so the basic 6-column view (cond /
      // temp / wind / precip / humidity / uv + sticky "Cuándo")
      // fits inside ~390 px before the user has to scroll. The
      // original `px-1` (4 px each side) added up to 8 px per cell,
      // which was enough to push the rightmost column off-screen on
      // a 360-px phone with no visible hint that scrolling was
      // possible.
      //
      // B-NEW-7 (2026-07-24): reverted the `min-w-[40px] sm:min-w-[44px]`
      // floor that B-NEW-5 added. The user reported the cells
      // were now "wider" / heavier on desktop, which broke the
      // original "soft glow + tight columns" character. The
      // mobile UV-column wrap issue is fixed by the new
      // `whitespace-nowrap` instead — a value that overflows the
      // cell now extends past the cell border horizontally
      // (under the next column or off the right edge of the
      // table, both of which scroll / fade) instead of wrapping
      // onto a second line and overlapping the gradient's
      // narrow central band.
      //
      // B-NEW-6 (2026-07-24): `whitespace-nowrap` added to fix
      // the UV column "splits the data in two halves" visual
      // bug. The previous code let a value like "5.8" (3 chars
      // at 11 px ≈ 21 px) wrap onto two lines inside a 40-px
      // cell, which combined with the narrow radial gradient
      // to render the value with one half on the colored
      // center and the other half on the transparent edges.
      // With nowrap the value is forced to a single line and
      // the cell overflows horizontally (still readable thanks
      // to the gradient on the colored center).
      className={`text-center px-1.5 sm:px-1 py-1.5 font-mono tabular-nums whitespace-nowrap [color:var(--heat-cell-text)] ${extraClass} ${hideOnCompact ? 'hidden' : ''} [contain:layout_style_paint]`}
      style={style}
    >
      {node}
    </td>
  )
})

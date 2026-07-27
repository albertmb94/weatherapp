'use client'

import { useMemo, useState, useCallback, useRef, useEffect, memo } from 'react'
import type { WeatherModel, MetricId } from '@/lib/models'
import { ENSEMBLE_PRESETS, METRIC_TO_ENSEMBLE } from '@/lib/models'
import { getColor, SCALES } from '@/lib/colorScales'
import type { ScaleMetric } from '@/lib/colorScales'
import { weightedAvg } from '@/lib/ensemble'
import { resolveActiveModels, weightsFor, weightsForAbsolute, ensembleWithFallback } from '@/lib/ensemble/central'
import { pickWeatherIcon, type WeatherIconId } from '@/lib/weatherIcon'
import { useLocale } from '@/lib/LocaleContext'
import { DAY_NAMES, STRINGS } from '@/lib/i18n'
import { useClientNow } from '@/lib/hooks/useClientNow'
import { useInsightPagination } from '@/lib/hooks/useInsightPagination'
import { heatStyle as heatStyleFn } from './heatStyle'
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
  { id: 'pressure', labelKey: 'tablePressure' },
  { id: 'dewpoint', labelKey: 'tableDewpoint' },
  { id: 'visibility', labelKey: 'tableVisibility' },
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
// Sprint 14: heatStyle was extracted to `components/heatStyle.ts` so
// `MobileInsightsCard` can reuse it without an import cycle through
// the 1700-line InsightsTable. The helper retains the memoisation
// cache and the same intensity / colour mapping it had inline. The
// export below re-exposes it under the legacy local name so the
// remaining `cellInner` callers (which still live in this file) keep
// working without renaming.
// eslint-disable-next-line @typescript-eslint/no-redeclare
const heatStyle = heatStyleFn

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

function bucketLabel(start: Date, end: Date, bucket: BucketHours, locale: 'es' | 'en', utcOffsetSeconds: number, nowMs: number | null): string {
  // M5: compare the location's "today" (in the location's timezone) instead
  // of the browser's "today", otherwise the label flips between "Hoy" /
  // "Mañ" and a weekday at the wrong moment when the user is in a TZ
  // different from the location.
  //
  // B-NEW-21 (2026-07-27): the previous version derived `today` from
  // `Date.now()`. That captured the server's clock on SSR and the
  // client's clock on hydration, and the diff (typically a few seconds,
  // but occasionally a timezone-aligned tick across midnight) produced
  // a different `isToday` / weekday label between the two renders —
  // exactly the kind of mismatch React rejects with hydration error
  // #418. We now require the caller to pass `nowMs` (the forecast's
  // own timestamp, which is consistent across the server and client)
  // and derive "today" from that instead. `nowMs` is `null` until the
  // parent's `useEffect` runs — in that case we fall back to the
  // pre-hydration weekday label so the SSR and the first client render
  // are byte-identical. The `useEffect` then updates `nowMs` and the
  // table re-renders with the correct "Hoy"/"Mañ" tags.
  const today = new Date((nowMs ?? 0) + utcOffsetSeconds * 1000)
  const isToday = start.getUTCFullYear() === today.getUTCFullYear() && start.getUTCMonth() === today.getUTCMonth() && start.getUTCDate() === today.getUTCDate()
  const isTomorrow = (() => {
    const t = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    return start.getUTCFullYear() === t.getUTCFullYear() && start.getUTCMonth() === t.getUTCMonth() && start.getUTCDate() === t.getUTCDate()
  })()
  const s = STRINGS[locale]
  const day = isToday ? s.today : isTomorrow ? s.tomorrow : `${DAY_NAMES[locale][start.getUTCDay()]} ${start.getUTCDate()}`
  if (bucket === 24) return day
  const h0 = start.getUTCHours().toString().padStart(2, '0')
  if (bucket === 1) return `${day} ${h0}h`
  const h1 = end.getUTCHours().toString().padStart(2, '0')
  return `${day} ${h0}–${h1}`
}

export interface CellResult {
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
         suffix: '',
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
      return cellInner({ value: r.humidityMean, metric: 'humidity', suffix: '' })
    case 'uv':
      return cellInner({ value: r.uvIndexMean, metric: 'uv_index', decimals: 1 })
    case 'pressure':
      return cellInner({ value: r.pressureMean, metric: 'pressure', decimals: 0 })
    case 'dewpoint':
      // Header already carries "Rocío °C" — cell shows raw value
      // (e.g. "18.9") with 1 decimal.
      return cellInner({ value: r.dewpointMean, metric: 'dewpoint', suffix: '', decimals: 1 })
    case 'visibility':
      // Header already carries "Vis km" — cell shows raw value (e.g.
      // "12.3") with 1 decimal.
      return cellInner({ value: r.visibilityMean, metric: 'visibility', suffix: '', decimals: 1 })
    case 'sea_surface_temperature':
      // The header already says "Mar °C", so the cell just shows
      // the rounded integer — no suffix, 0 decimals. "28" (2 chars)
      // at 11 px font-mono fits well inside the 48 px column.
      return cellInner({ value: r.seaTempMean, metric: 'sea_surface_temperature', suffix: '', decimals: 0 })
    case 'wave_height':
      // The header already says "Ola m". Cell shows the raw value
      // with 1 decimal and no unit suffix. "0.6" (3 chars) fits
      // cleanly in 48 px.
      return cellInner({ value: r.waveHeightMax, metric: 'wave_height', suffix: '', decimals: 1 })
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
  //
  // Sprint 14: the pagination state machine, the slice helper, the
  // bucket-change reset effect and the scroll-to-top handlers were
  // extracted to `useInsightPagination` (Sprint 12). The component
  // just consumes the hook's outputs and renders the existing
  // markup.
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
// Sprint 14: this effect is now owned by `useInsightPagination`.

  // B-NEW-21 (2026-07-27): the "today" anchor used by `bucketLabel`
  // must be the same on the server and the client. The forecast's
  // own timestamp is the natural choice — it's stamped by the
  // Open-Meteo response and stays consistent across renderers. We
  // start the state at `null` (matches the SSR render and the first
  // client render) and set the actual `nowMs` in a useEffect that
  // only runs on the client after hydration. The 1-frame flash where
  // "today" labels are wrong is the documented trade-off vs. an SSR
  // mismatch that aborts the whole tree.
  // "Today" anchor for the bucket labels: prefer the upstream `times[0]`
  // (a stable stamp from the Open-Meteo response) and fall back to the
  // client wall clock only when the response didn't carry a time array.
  // Using `useSyncExternalStore` (via `useClientNow`) keeps React 19
  // strict-mode clean while still ticking every minute.
  const wallClock = useClientNow(60_000)
  const nowMs: number | null = times[0] instanceof Date ? times[0].getTime() : wallClock

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

    const getWeightsForMetricAndHour = (metric: MetricId | string, hourIndex: number): number[] => {
      if (ensembleMode === 'models') return staticWeights
      // `hourIndex` here is already offset by `startIndex` because
      // the time series we receive is the trimmed `viewTimes`.
      // Pass it as absolute to avoid the previous bucket
      // mis-classification where rows past the first day were
      // tagged with the 0-48h preset.
      return weightsForAbsolute(metric as MetricId, hourIndex + startIndex, bucket, activeModels)
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
              ? bucketLabel(labelT, labelT, bucket, locale, utcOffsetSeconds, nowMs)
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
          label: bucketLabel(new Date(startT.getTime() - startInBucket * 3600_000), endT, bucket, locale, utcOffsetSeconds, nowMs),
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
  // Sprint 14 revert: the mobile-portrait card layout was
  // rejected by the user (they preferred the table even on
  // phone). The anti-scroll requirement is now enforced at the
  // CSS level (table-fixed, fixed column widths, ellipsis on
  // overflowing values) so the table fits inside the viewport
  // in portrait without any horizontal scrollbar. The
  // `isMobilePortrait` flag is no longer needed for branching
  // the JSX; we keep a slim variant only to detect "in portrait
  // on a phone" so we can apply the tighter column filter
  // (basic cols only + key marine cols) that previously lived
  // under the card layout. Without that filter the table would
  // overflow even with table-fixed + ellipsis.
  const [isMobilePortrait, setIsMobilePortrait] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 767px) and (orientation: portrait)')
    const update = (e: MediaQueryListEvent | MediaQueryList) => setIsMobilePortrait(e.matches)
    update(mq)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Sprint 14 / landscape scroll: when the user activates Marine +
  // Basic on a phone in landscape, the full column set (~21 cols)
  // overflows the viewport and every cell gets text-overflow:
  // ellipsis. We detect landscape-on-phone here so the container
  // can switch from overflow-x-hidden to overflow-x-auto,
  // letting the user scroll horizontally through the columns.
  const [isMobileLandscape, setIsMobileLandscape] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 1023px) and (orientation: landscape)')
    const update = (e: MediaQueryListEvent | MediaQueryList) => setIsMobileLandscape(e.matches)
    update(mq)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Sprint 16 follow-up: we no longer rely on CSS
  // visibility-or-desktop classes (Tailwind v4 doesn't honour a
  // comma-OR media query inside @custom-variant — only the
  // first clause got compiled). We watch "real-desktop" in JS
  // and only include pressure/dewpoint/visibility when the
  // viewport is wide enough for them to read cleanly.
  const [isRealDesktop, setIsRealDesktop] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(min-width: 1024px)')
    const update = (e: MediaQueryListEvent | MediaQueryList) => setIsRealDesktop(e.matches)
    update(mq)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Sprint 14 revert (v2): the column set for mobile portrait is split
  // into basic and marine so `showMarine` controls whether marine
  // columns appear. Previously both were in one set, which caused
  // two bugs:
  //   1. marine columns rendered even when `showMarine` was false
  //      (with empty values because marine_global data was missing).
  //   2. in portrait with Marine ON, 8 data columns + sticky didn't
  //      fit in 360 px, causing visible text overlap.
  //
  // The fix: show up to 6 data columns in portrait regardless of
  // marine state — when marine is OFF, show the 6 basic columns;
  // when marine is ON, replace humidity + uv with sea_temp + wave_height.
  const PORTRAIT_BASIC_COLS = useMemo(
    () => new Set<MetricCellId>([
      'cond', 'temp', 'wind', 'precip', 'humidity', 'uv',
    ]),
    []
  )
  // When marine is ON in portrait, humidity + uv are replaced by
  // the two key marine columns so the total stays at 6 data cols.
  const PORTRAIT_MARINE_REPLACEMENT = useMemo(
    () => new Set<MetricCellId>([
      'cond', 'temp', 'wind', 'precip',
    ]),
    []
  )
  const PORTRAIT_MARINE_COLS = useMemo(
    () => new Set<MetricCellId>([
      'sea_surface_temperature', 'wave_height',
    ]),
    []
  )

  // Extra columns that only render when there is enough horizontal
  // budget — pressure, dewpoint and visibility need ~60 px each to
  // read well and would crowd the basic 6+1 set on narrow phones.
  // The (min-width: 1024px) or "phone landscape" criteria mirror the
  // original `visibility-or-desktop` hideClass, but resolved in JS
  // because Tailwind v4 doesn't compile a comma-OR media query in
  // `@custom-variant`. See globals.css for the phone-palette media
  // query that informs the same shape as isMobileLandscape above.
  const wideLayout = isRealDesktop || isMobileLandscape
  const PRESSURE_DEWPOINT_VIS = useMemo<Set<MetricCellId>>(
    () => new Set(['pressure', 'dewpoint', 'visibility']),
    []
  )

  const visibleIds = useMemo(
    () => columnOrder.filter(id => {
      if (isMobilePortrait) {
        // Portrait always shows exactly 6 data columns.
        // Marine OFF: cond, temp, wind, precip, humidity, uv
        // Marine ON:  cond, temp, wind, precip, sea_temp, wave_height
        // (humidity + uv are replaced by sea_temp + wave_height)
        if (showMarine && marineColIds.has(id)) {
          return PORTRAIT_MARINE_COLS.has(id)
        }
        if (showMarine) {
          return PORTRAIT_MARINE_REPLACEMENT.has(id)
        }
        return PORTRAIT_BASIC_COLS.has(id)
      }
      // Phone portrait (no) AND non-wide layout (no) -> drop the
      // three wide columns; in this branch we still want them on
      // real desktop (>=1024) and phone landscape so the wide
      // view matches what the user expects.
      if (PRESSURE_DEWPOINT_VIS.has(id) && !wideLayout) return false
      if (!showMarine && marineColIds.has(id)) return false
      if (showMarine && !showBasic && !marineColIds.has(id)) return false
      return true
    }),
    [
      columnOrder,
      showMarine,
      showBasic,
      isMobilePortrait,
      wideLayout,
      marineColIds,
      PORTRAIT_BASIC_COLS,
      PORTRAIT_MARINE_COLS,
      PORTRAIT_MARINE_REPLACEMENT,
      PRESSURE_DEWPOINT_VIS,
    ]
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
  // Sprint 14: the pagination state machine + helpers now live in
  // `useInsightPagination`. We slice `rows` here using the hook's
  // computed window and read its `hasNext` / `hasPrev` /
  // `remaining` flags for the CTA rows below. The hook must be
  // called AFTER `rows` is computed so the row count we hand it is
  // accurate (the hook uses it to clamp the page index).
  const pagination = useInsightPagination(rows.length, bucket)
  const { visibleStart: pageStart, visibleEnd: pageEnd, visibleRows: paginateRows, hasNext, hasPrev, remaining, onNextClick, onPrevClick } = pagination
  const visibleRows = paginateRows(rows)
  const visibleCellsByRow = paginateRows(cellsByRow)
  const safePage = pagination.page
  const INSIGHTS_PAGE_SIZE = pagination.pageSize

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
          {rows.length > INSIGHTS_PAGE_SIZE ? (
            <span className="ml-auto text-[10px] tabular-nums text-text-muted">
              {locale === 'en'
                ? `Page ${safePage + 1} / ${Math.ceil(rows.length / INSIGHTS_PAGE_SIZE)} · hours ${pageStart + 1}–${pageEnd}`
                : `Pág. ${safePage + 1} / ${Math.ceil(rows.length / INSIGHTS_PAGE_SIZE)} · horas ${pageStart + 1}–${pageEnd}`}
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
            className={`shrink-0 real-desktop:hidden px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors min-h-[28px] ${compact ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'}`}
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
          // Sprint 14: the scrollState handler is removed. The
          // container is overflow-x-hidden below md, so there is no
          // horizontal scroll event to track. The visual hint
          // gradients are also gone. We keep the ref because the
          // pagination hook uses it for scroll-to-top.
          //
          // Sprint 14 / landscape scroll: when Marine + Basic are
          // both active on a phone in landscape, the full column
          // set (~21 cols) overflows ~800 px. We switch to
          // overflow-x-auto so the user can scroll horizontally
          // through the columns without losing the overview.
          className={`relative max-h-[70vh] contain-[layout_style_paint] ${
            // Portrait: never horizontal scroll (user complained about
            // "no debe existir scroll horizontal" en vertical).
            // Landscape phone: ALWAYS allow horizontal scroll because
            // the table now shows min/max/clouds/gusts (+ marine cols
            // when marine is on) — those don't fit inside 390 px.
            // Desktop: auto overflow as usual.
            isMobilePortrait
              ? 'overflow-x-hidden'
              : isMobileLandscape
                ? 'overflow-x-auto'
                : 'overflow-x-hidden real-desktop:overflow-auto'
          }`}
        >
          {/* Sprint 14: scroll-hint gradients removed. The previous
              gradient masks signalled "more content to scroll" on
              the right edge — with the new
              `overflow-x-hidden` + `table-fixed` + ellipsis
              container, the table never produces a horizontal
              scrollbar in portrait, so the hint is misleading. The
              landscape case (>sm) gets the same `overflow-x-hidden`
              by default; the `md:overflow-auto` restoration only
              takes over on screens wider than md where the column
              filter is loose enough that horizontal scroll may be
              the right fallback for an extremely dense marine
              view. */}
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
            // Sprint 16: dropped `table-fixed`. With auto layout
            // the browser distributes columns proportionally — each
            // column gets the width of its widest cell, the sticky
            // column uses the CSS variable (which switches on
            // viewport), and the rest of the horizontal space fills
            // out automatically. We still need overflow hidden on
            // each cell so that, when the table does exceed its
            // container (e.g. mobile-landscape with marine on),
            // the user can scroll horizontally and the content clips
            // instead of overlapping into the next column.
            className="w-full border-collapse text-xs [&_th]:text-[11px] [&_td]:text-[11px] [&_span]:text-[11px]"
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
                  // Sprint 16: explicit pixel width per column id
                  // so the table distributes space proportionally to
                  // each column's actual content, not equally. With
                  // `table-fixed` + `width: auto` every column
                  // shared the remaining space equally — that gave
                  // the first 4 columns ~30 px and pushed every
                  // Sprint 16: explicit pixel width per column id
                  // so the table distributes space proportionally to
                  // each column's actual content, not equally. With
                  // `table-fixed` + `width: auto` every column
                  // shared the remaining space equally — that gave
                  // the first 4 columns ~30 px and pushed every
                  // marine column to 48 px of empty space, exactly
                  // the "primeras 4 muy estrechas, ultimas 4 muy
                  // anchas" complaint. With explicit widths the
                  // table now uses its full horizontal budget on
                  // every viewport and stops fighting the layout
                  // for breathing room.
                  //
                  // Sprint 16: the inline `visibility: collapse` is
                  // applied only when the hideClass contains `hidden`
                  // (i.e. the column is hidden by the CSS rule, not
                  // by the JS visibleIds filter). For pressure/
                  // dewpoint/visibility we removed the hideClass
                  // entirely and let the JS decide whether to render
                  // the <col>, so this branch never fires for them.
                  // Sprint 16: dropped the per-column pixel width so
                  // the table distributes space proportionally to
                  // each column's actual content (table-auto +
                  // auto-width cells). Only the invisible collapse
                  // hook for hideClass-based hide retains its
                  // inline style. The first column keeps its
                  // --when-col-w via the dedicated <col> above.
                  className={col.hideClass ?? ''}
                  style={col.hideClass && /\bhidden\b/.test(col.hideClass)
                    ? { visibility: 'collapse' as const }
                    : undefined}
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
                data-col-id="__when__"
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
                    // Sprint 16: `overflow-hidden` clips long header
                    // text so it cannot visually bleed into the
                    // adjacent column. The `whitespace-nowrap` on the
                    // header text naturally prefers a single line;
                    // without `overflow-hidden` the text overflows
                    // over the next header cell.
                    className={`sticky top-0 z-40 bg-surface text-center px-1 py-1.5 real-desktop:px-2.5 font-medium border-b border-border cursor-grab active:cursor-grabbing select-none tabular-nums text-text-secondary overflow-hidden ${col.hideClass ?? ''} ${compact && COMPACT_HIDDEN_COLS.has(col.id) ? 'hidden' : ''} ${dragClass}`}
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
                onClick={() => onPrevClick(tableContainerRef)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onPrevClick(tableContainerRef)
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
                    //
                    // B-NEW-21 (2026-07-27): the user asked for the
                    // text on a single line ("con el texto en una
                    // sola fila") regardless of marine state, AND
                    // for all cells to have the same height. The
                    // previous form switched `whitespace-normal`
                    // on/off with `showMarine`, so without marine
                    // the text wrapped to 2 lines and broke row-height
                    // consistency. We now use `whitespace-nowrap`
                    // always (the column is wide enough — see
                    // `--when-col-w` 84 px / 64 px in app/globals.css).
                    //
                    // For row-height consistency we additionally
                    // reserve the chip area on EVERY row with
                    // `min-h-[14px]`, even when the chip isn't
                    // shown. This way every Cuándo cell is at
                    // least `12px padding-top + 14px chip + 2px
                    // margin + 17px label + 12px padding-bottom =
                    // ~57px`, with the chip area empty on non-active
                    // rows. The active row paints the chip in that
                    // reserved space; all rows now have the same
                    // height (57px on a single line + chip) so the
                    // table doesn't get the "step" between bucket=24
                    // and bucket=1/2/6/12 the user complained about.
                    className={`sticky left-0 z-20 px-1.5 py-1.5 whitespace-nowrap text-text-primary border-b border-border-r border-border/60 shadow-[2px_0_4px_rgba(0,0,0,0.5)] tabular-nums ${whenBg}`}
                  >
                    {/* Sprint 10 / B-10-2: when bucket=24 and the user is
                       on the actual current hour (selectedHour === 0),
                       the active row's tempMean is the CURRENT hour's
                       temperature (B-10-1 forced WedAI for the current
                       hour). The chip clarifies that so the user
                       doesn't read it as a daily average. For any
                       other selectedHour (e.g. tomorrow) we do not
                       show "Ahora" — the value is a forecast for that
                       future hour.

                       B-NEW-21 (2026-07-27): the chip div is now
                       always rendered (with an empty string when
                       the conditions don't hold) so the cell
                       height stays the same across all rows.
                       Previously the active row was taller than
                       the others, which broke row-height
                       consistency. The wrapper has min-h-[14px]
                       (= 11 px font × 1.25 leading-tight + small
                       breathing room) so the chip area is
                       reserved even when empty. */}
                    <div
                      className="text-[9px] uppercase tracking-wider font-semibold text-accent mb-0.5 leading-tight min-h-[14px]"
                      aria-label="Hora actual"
                      data-testid="ahora-chip"
                    >
                      {isActive && bucket === 24 && selectedHour === 0 && r.tempMean !== null
                        ? `↳ Ahora · ${Math.round(r.tempMean)}°`
                        : ''}
                    </div>
                    {r.label}
                  </td>
                  {colDefs.map((col, j) => (
                    <HeatCell
                      key={col.id}
                      node={rowCells[j]?.node}
                      style={rowCells[j]?.style}
                      hideOnCompact={compact && COMPACT_HIDDEN_COLS.has(col.id)}
                      extraClass={col.hideClass ?? ''}
                      isPortrait={isMobilePortrait}
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
                onClick={() => onNextClick(tableContainerRef)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onNextClick(tableContainerRef)
                  }
                }}
                aria-label={
                  locale === 'en'
                    ? `Show next ${Math.min(INSIGHTS_PAGE_SIZE, remaining)} hours`
                    : `Mostrar siguientes ${Math.min(INSIGHTS_PAGE_SIZE, remaining)} horas`
                }
                className="cursor-pointer bg-surface-popover/40 hover:bg-accent/10 transition-colors focus-visible:bg-accent/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                data-testid="next-page-cta"
              >
                <td
                  colSpan={colDefs.length + 1}
                  className="text-center px-2 py-3 text-[11px] text-text-secondary tabular-nums border-t border-border"
                >
                  <span className="font-semibold text-accent">
                    {STRINGS[locale].insightsShowNext.replace('{n}', String(Math.min(INSIGHTS_PAGE_SIZE, remaining)))}
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
      // Using inline layout (not flex) so the parent <td>'s
      // text-overflow: ellipsis reliably clips overflowing content.
      // inline-flex children bypass the <td>'s text-overflow in
      // several browsers, causing visible overlap between columns.
      <span className="relative z-10" title={tooltip}>
        {icon ? (
          <span className="align-middle mr-0.5 leading-none">{icon}</span>
        ) : emoji ? (
          <span aria-hidden className="text-xs align-middle mr-0.5 leading-none">{emoji}</span>
        ) : null}
        <span className="align-middle leading-none">{display}{suffix}</span>
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
  isPortrait,
}: {
  node: React.ReactNode
  style: React.CSSProperties | undefined
  hideOnCompact: boolean
  extraClass: string
  isPortrait?: boolean
}) {
  return (
    <td
      // Sprint 14 / fit guarantee: text-overflow: ellipsis is
      // REMOVED from every cell — the column set, the reduced
      // padding in portrait (px-0.5), the removal of redundant
      // unit suffixes from cell values (units are already in the
      // header labels), and the explicit marine column widths
      // jointly guarantee that every value fits inside its
      // column at every viewport width >= 320 px (iPhone SE
      // through iPhone 16 Pro Max). No cell should ever display
      // "…". overflow-hidden is kept as a safety net for edge
      // cases (zoomed text, unusual fonts).
      className={`text-center py-1.5 font-mono tabular-nums whitespace-nowrap overflow-hidden [color:var(--heat-cell-text)] ${extraClass} ${hideOnCompact ? 'hidden' : ''} [contain:layout_style_paint] ${
        isPortrait
          ? 'px-0.5'
          : 'px-1.5 sm:px-1 real-desktop:px-2.5'
      }`}
      style={style}
    >
      {node}
    </td>
  )
})

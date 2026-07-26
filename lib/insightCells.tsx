/**
 * Cell rendering helpers for `InsightsTable.tsx`.
 *
 * These produce the JSX (or `React.ReactNode`) for each `<td>` in
 * the table. They are kept in their own module so the component
 * file stays focused on layout and the cells can be tested in
 * isolation (snapshot + unit tests live in
 * `__tests__/insightCells.test.tsx`).
 */

import { getColor } from '@/lib/colorScales'
import { heatStyle, type Row } from './insightRowBuilder'
import { fetchWithTimeout } from '@/lib/fetchWithTimeout'
import type { ScaleMetric } from '@/lib/colorScales'
import type { MetricCellId } from './insightsTableMeta'

export interface CellResult {
  node: React.ReactNode
  style?: React.CSSProperties
  textClassName?: string
}

export interface CellInnerArg {
  value: number | null
  metric: ScaleMetric
  suffix?: string
  decimals?: number
  icon?: React.ReactNode
  tooltip?: string
}

const NO_VALUE_PLACEHOLDER = '–'

/** Default visual style for cells that don't carry a heat value. */
export const TRANSPARENT_CELL_STYLE: React.CSSProperties = { background: 'transparent' }

/**
 * Render one cell's value with a uniform shape: numeric value +
 * suffix + optional decorative icon + optional tooltip. Returns
 * the JSX node plus the cell's heatmap style, computed from the
 * provided `metric` so the colour gradient stays consistent across
 * the entire table.
 */
export function cellInner({
  value,
  metric,
  suffix = '',
  decimals = 0,
  icon,
  tooltip,
}: CellInnerArg): CellResult {
  if (value === null) {
    return { node: <span aria-hidden="true">{NO_VALUE_PLACEHOLDER}</span>, style: TRANSPARENT_CELL_STYLE }
  }
  const formatted = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString()
  return {
    node: (
      <span title={tooltip}>
        {icon}
        {icon ? ' ' : ''}
        <span>{formatted}{suffix}</span>
      </span>
    ),
    style: heatStyle(metric, value),
  }
}

/** Convenience: the empty-cell marker (used by `cellData` falls-through). */
export function emptyCell(): CellResult {
  return { node: <span aria-hidden="true">{NO_VALUE_PLACEHOLDER}</span>, style: TRANSPARENT_CELL_STYLE }
}

/* -------------------------------------------------------------------------- */
/* Per-column renderer (`cellData`)                                         */
/* -------------------------------------------------------------------------- */

function WindArrow({ degrees }: { degrees: number | null }) {
  if (degrees === null) {
    return { node: null }
  }
  const rot = (degrees + 180) % 360
  return {
    node: (
      <svg
        viewBox="0 0 16 16"
        className="w-3 h-3 inline-block"
        style={{ transform: `rotate(${rot}deg)` }}
        aria-hidden
      >
        <path d="M8 1.5 L4 8 L7 8 L7 14.5 L9 14.5 L9 8 L12 8 Z" fill="currentColor" />
      </svg>
    ),
  }
}

/**
 * Render one Insight cell given a column id and a row.
 *
 * The bucket argument is forwarded so the renderer can pick a
 * different precision (e.g. 1 decimal on per-hour buckets, 0 on the
 * day card). The function is the single source of truth for what
 * each column looks like, which keeps the JSX in `InsightsTable.tsx`
 * a thin layout wrapper.
 */
export function cellData(
  id: MetricCellId,
  r: Row,
  _bucket: BucketHoursIgnoredForLinter,
): CellResult {
  // B-NEW-15 (2026-07-26): every temperature cell uses 0 decimals so
  // the strings stay single-digit so they fit in any column width.
  switch (id) {
    case 'cond':
      return {
        node: null,
        style: TRANSPARENT_CELL_STYLE,
      }
    case 'temp':
      return cellInner({ value: r.tempMean, metric: 'temperature', suffix: '°', decimals: 0 })
    case 'min':
      return cellInner({ value: r.tempMin, metric: 'temperature', suffix: '°', decimals: 0 })
    case 'max':
      return cellInner({ value: r.tempMax, metric: 'temperature', suffix: '°', decimals: 0 })
    case 'clouds':
      return cellInner({ value: r.cloudMean, metric: 'cloud_cover', suffix: '%' })
    case 'wind':
      return cellInner({
        value: r.windMean,
        metric: 'wind_speed',
        icon: WindArrow({ degrees: r.windDirection }).node,
        tooltip:
          r.windDirection !== null ? `${Math.round(r.windDirection)}°` : undefined,
      })
    case 'gusts':
      return cellInner({
        value: r.gustsMax,
        metric: 'wind_gusts',
        icon: WindArrow({ degrees: r.windDirection }).node,
        tooltip:
          r.windDirection !== null ? `${Math.round(r.windDirection)}°` : undefined,
      })
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
      return cellInner({
        value: r.seaTempMean, metric: 'sea_surface_temperature', suffix: '°', decimals: 1,
      })
    case 'wave_height':
      return cellInner({ value: r.waveHeightMax, metric: 'wave_height', suffix: 'm', decimals: 1 })
    case 'wave_period':
      return cellInner({ value: r.wavePeriodMean, metric: 'wave_period', suffix: 's', decimals: 0 })
    case 'wave_direction':
      return cellInner({
        value: r.waveDirection,
        metric: 'wave_direction',
        suffix: '°',
        decimals: 0,
        icon: WindArrow({ degrees: r.waveDirection }).node,
        tooltip: r.windDirection !== null ? `${Math.round(r.windDirection)}°` : undefined,
      })
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

type BucketHoursIgnoredForLinter = 1 | 2 | 3 | 4 | 6 | 12 | 24

/**
 * Convenience: the same as `cellData` but for arrays of column
 * ids, used by `InsightsTable` to memo-render the entire row at
 * once. Pre-computed cells keep the JSX of the component a thin
 * wrapper and let `<td key={...}>{cell.node}</td>` repeat without
 * recomputation.
 */
export function cellsByRow(rows: Row[], colIds: MetricCellId[], bucket: BucketHoursIgnoredForLinter): CellResult[][] {
  const out: CellResult[][] = []
  for (const r of rows) {
    const row: CellResult[] = []
    for (const id of colIds) {
      row.push(cellData(id, r, bucket))
    }
    out.push(row)
  }
  return out
}

// Re-export a typed type that the JSX in InsightsTable.tsx uses to
// avoid pulling `MetricId` directly.
export type { ScaleMetric }

// `fetchWithTimeout` is re-exported here so the only place that
// imports the network helpers from a UI module remains the cell
// renderer. (Kept here only as a guard to make sure dead-code
// detection does not strip a future caller.)
void fetchWithTimeout

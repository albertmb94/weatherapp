/**
 * Constants and helpers for the Insights table component.
 *
 * Extracted from `components/InsightsTable.tsx` in S11 / Sprint 7 to
 * keep the component focused on rendering. These are the contract
 * pieces: the canonical column order, the persisted column order
 * helpers, and the shared CSS-property cache for cell shading.
 */

import type { MetricId } from '@/lib/models'
import { STRINGS } from '@/lib/i18n'

export type BucketHours = 1 | 2 | 3 | 4 | 6 | 12 | 24

export const BUCKET_OPTIONS: BucketHours[] = [1, 2, 6, 12, 24]

export const BUCKET_LABELS: Record<BucketHours, string> = {
  1: '1h',
  2: '2h',
  3: '3h',
  4: '4h',
  6: '6h',
  12: '12h',
  24: '1d',
}

/** Each ordered column in the Insights table. The string ids are
 *  the persisted (localStorage) format; `sortBy` would be a future
 *  refactor — keep the order stable for now. */
export type MetricCellId =
  | 'cond' | 'temp' | 'min' | 'max' | 'clouds'
  | 'wind' | 'gusts' | 'precip' | 'humidity'
  | 'uv' | 'pressure' | 'dewpoint' | 'visibility'
  | 'sea_surface_temperature'
  | 'wave_height' | 'wave_period' | 'wave_direction'
  | 'wind_wave_height' | 'wind_wave_period'
  | 'swell_wave_height' | 'swell_wave_period'

export interface MetricColumnDef {
  id: MetricCellId
  labelKey: keyof typeof STRINGS['en']
  hideClass?: string
}

export const METRIC_COLUMNS: MetricColumnDef[] = [
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

export const DEFAULT_ORDER: MetricCellId[] = METRIC_COLUMNS.map(c => c.id)

export const COLUMN_ORDER_STORAGE_KEY = 'insights-column-order'

/** Hydrate the user's saved column order or fall back to the default. */
export function loadColumnOrder(): MetricCellId[] {
  if (typeof window === 'undefined') return DEFAULT_ORDER
  try {
    const raw = window.localStorage.getItem(COLUMN_ORDER_STORAGE_KEY)
    if (!raw) return DEFAULT_ORDER
    const parsed = JSON.parse(raw) as string[]
    const validIds = new Set<string>(DEFAULT_ORDER)
    if (parsed.length === DEFAULT_ORDER.length && parsed.every(id => validIds.has(id))) {
      return parsed as MetricCellId[]
    }
  } catch {}
  return DEFAULT_ORDER
}

export function saveColumnOrder(order: MetricCellId[]) {
  try {
    localStorage.setItem(COLUMN_ORDER_STORAGE_KEY, JSON.stringify(order))
  } catch {}
}

/**
 * Set of column ids hidden on the *Basic* view. The marine columns
 * are always off, so they live in their own set (`MARINE_COLUMN_IDS`)
 * that callers expose via `showMarine`.
 */
export const BASIC_HIDDEN_COLS: ReadonlySet<MetricCellId> = new Set<MetricCellId>([
  'min', 'max', 'clouds', 'gusts', 'humidity', 'uv', 'pressure', 'dewpoint', 'visibility',
])

export const MARINE_COLUMN_IDS: ReadonlySet<MetricCellId> = new Set<MetricCellId>([
  'sea_surface_temperature',
  'wave_height', 'wave_period', 'wave_direction',
  'wind_wave_height', 'wind_wave_period',
  'swell_wave_height', 'swell_wave_period',
])

/** Mobile portrait + marine keeps only the columns that survive a
 *  narrow viewport. */
export const MOBILE_PORTRAIT_KEY_COLS: ReadonlySet<MetricCellId> = new Set<MetricCellId>([
  'temp', 'wind', 'precip',
  'sea_surface_temperature', 'wave_height',
])

/** Helpers exported so the component can shape its visible-ids set
 *  without rebuilding the underlying constant. */
export function shouldShowColumn(
  id: MetricCellId,
  showMarine: boolean,
  showBasic: boolean,
  isMobilePortrait: boolean,
): boolean {
  if (showMarine && isMobilePortrait) {
    return MOBILE_PORTRAIT_KEY_COLS.has(id)
  }
  if (!showMarine && MARINE_COLUMN_IDS.has(id)) return false
  if (showMarine && !showBasic && !MARINE_COLUMN_IDS.has(id)) return false
  return true
}

export type { MetricId }

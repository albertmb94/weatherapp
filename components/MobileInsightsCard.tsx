'use client'

/**
 * Sprint 14: `MobileInsightsCard` — the mobile-portrait rendering of
 * the Insights table.
 *
 * Why a separate component:
 *   - The table layout hard-codes column widths via `<colgroup>`,
 *     sticky first column, and `whitespace-nowrap` on each cell.
 *     On a 360-px portrait phone the natural table width exceeds
 *     the viewport and the previous behaviour was to expose a
 *     horizontal scrollbar. The user explicitly asked for "no
 *     horizontal scroll in portrait" so this component renders the
 *     same forecast data as a stack of cards.
 *   - Each card is a self-contained 1-row slice: header (bucket
 *     label + icon + temperature + trend), then a chip strip of
 *     every visible metric, then optional marine chips. Clicking
 *     the card calls `onSelectHour(centerIdx - startIndex)` just
 *     like the table row did.
 *   - The cards read the same `rows`, `cellsByRow`, and
 *     `colDefs` data the table consumes; nothing is recomputed.
 *     `visibleRows` / `visibleCellsByRow` come from the parent so
 *     pagination continues to work.
 *   - The component renders an empty `<div>` when `rows.length ===
 *     0`, matching the table's `activeModels.length === 0` early
 *     return (the parent already filters empty states).
 */

import { memo } from 'react'
import WeatherConditionIcon from './WeatherConditionIcon'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import type { CellResult } from './InsightsTable'

// Re-import the heat-style helper from the parent module via a small
// indirection so we don't import the entire 1700-line file just for
// one utility. We use a dynamic require-ish trick: import the helper
// at module scope, which already happens above.

interface MetricChipProps {
  cell: CellResult | undefined
  label: string
}

function MetricChip({ cell, label }: MetricChipProps) {
  if (!cell) return null
  const hasValue = cell.node !== null
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-surface-popover/40 px-2 py-1 text-[11px] font-mono tabular-nums"
      data-mobile-card-chip=""
    >
      <span className="text-text-tertiary uppercase tracking-wide text-[9px] font-semibold">
        {label}
      </span>
      <span
        className="rounded px-1"
        style={cell.style ?? undefined}
        data-mobile-card-value=""
      >
        {hasValue ? cell.node : <span className="opacity-50">–</span>}
      </span>
    </span>
  )
}

export interface MobileInsightsCardProps {
  /** Pre-built label string from `bucketLabel(...)`. */
  label: string
  iconId: import('@/lib/weatherIcon').WeatherIconId
  /** Active? highlights the card. */
  isActive: boolean
  /** Cell for the temperature (always rendered in the header). */
  tempCell: CellResult | undefined
  /** Cells for the remaining columns (wind, precip, humidity, uv, marine). */
  metricChips: Array<{ id: string; label: string; cell: CellResult | undefined }>
  onClick: () => void
}

function MobileInsightsCardImpl({
  label,
  iconId,
  isActive,
  tempCell,
  metricChips,
  onClick,
}: MobileInsightsCardProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      aria-label={label}
      aria-pressed={isActive}
      data-mobile-insights-card=""
      data-active={isActive ? 'true' : 'false'}
      className={`block w-full text-left rounded-xl border ${isActive ? 'border-accent ring-1 ring-inset ring-accent/40 bg-accent-soft/30' : 'border-border bg-surface-raised/60'} px-3 py-2.5 mb-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <WeatherConditionIcon icon={iconId} size="sm" />
          <span className="text-[12px] font-semibold tabular-nums text-text-primary truncate">
            {label}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span
            className="text-base font-semibold tabular-nums px-1.5 rounded"
            style={tempCell?.style ?? undefined}
            data-testid="card-temp"
          >
            {tempCell?.node ?? <span className="opacity-50">–</span>}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {metricChips.map(chip => (
          <MetricChip key={chip.id} cell={chip.cell} label={chip.label} />
        ))}
      </div>
      {isActive && (
        <div className="mt-1.5 text-[10px] uppercase tracking-wider font-semibold text-accent">
          {s.profileChipNeutral === '' ? '' : '↳ ' + (locale === 'en' ? 'Selected hour' : 'Hora seleccionada')}
        </div>
      )}
    </div>
  )
}

const MobileInsightsCard = memo(MobileInsightsCardImpl)
export default MobileInsightsCard
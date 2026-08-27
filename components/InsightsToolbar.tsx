'use client'

import type { Locale } from '@/lib/i18n'
import { STRINGS } from '@/lib/i18n'
import type { BucketHours } from '@/lib/insightsTableMeta'
import { BUCKET_LABELS, BUCKET_OPTIONS } from '@/lib/insightsTableMeta'

interface InsightsToolbarProps {
  bucket: BucketHours
  onBucketChange: (b: BucketHours) => void
  showMarine?: boolean
  onMarineToggle?: () => void
  showBasic?: boolean
  onBasicToggle?: () => void
  locale: Locale
  /** When `false` the "Reset columns" button is hidden (default
   *  behaviour: show whenever the order diverges from default). */
  onResetColumns?: () => void
  /** Compact / wide toggle for mobile portrait. */
  compact?: boolean
  onCompactToggle?: () => void
  /** Visual cue when the column order differs from default. */
  columnsOutOfOrder?: boolean
}

/**
 * Toolbar above the Insights table with bucket pills + marine/basic
 * toggles + reset/compact. Lifted from the main component so the
 * 1705-line component can focus on the actual table.
 */
export default function InsightsToolbar({
  bucket,
  onBucketChange,
  showMarine = false,
  onMarineToggle,
  showBasic = true,
  onBasicToggle,
  locale,
  onResetColumns,
  compact,
  onCompactToggle,
  columnsOutOfOrder = false,
}: InsightsToolbarProps) {
  const s = STRINGS[locale]
  return (
    <div className="flex items-center gap-0.5 px-2 py-2 overflow-x-auto scrollbar-none border-b border-border">
      {BUCKET_OPTIONS.map(b => (
        <button
          key={b}
          onClick={() => onBucketChange(b)}
          className={`flex-1 px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors min-h-[28px] ${
            bucket === b ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
          }`}
          aria-pressed={bucket === b}
        >
          {BUCKET_LABELS[b]}
        </button>
      ))}
      {onMarineToggle ? (
        <button
          type="button"
          onClick={onMarineToggle}
          aria-pressed={showMarine}
          aria-label={s.marine}
          title={s.marine}
          className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-colors min-h-[28px] border ${
            showMarine
              ? 'bg-cyan-500 text-white border-cyan-500'
              : 'bg-surface-popover text-text-secondary border-border'
          }`}
        >
          {s.marine}
        </button>
      ) : null}
      {onBasicToggle ? (
        <button
          type="button"
          onClick={onBasicToggle}
          aria-pressed={showBasic}
          aria-label={s.basic}
          title={s.basic}
          className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-colors min-h-[28px] border ${
            showBasic
              ? 'bg-emerald-500 text-white border-emerald-500'
              : 'bg-surface-popover text-text-secondary border-border'
          }`}
        >
          {s.basic}
        </button>
      ) : null}
      {columnsOutOfOrder && onResetColumns ? (
        <button
          type="button"
          onClick={onResetColumns}
          className="shrink-0 px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors min-h-[28px] text-text-tertiary hover:text-text-secondary ml-0.5"
          title="Reset column order"
        >
          ↺
        </button>
      ) : null}
      {onCompactToggle ? (
        <button
          type="button"
          onClick={onCompactToggle}
          className={`shrink-0 md:hidden px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors min-h-[28px] ${
            compact
              ? 'bg-accent text-white'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
          title="Compact mode"
        >
          {compact ? '⊞' : '⊟'}
        </button>
      ) : null}
    </div>
  )
}

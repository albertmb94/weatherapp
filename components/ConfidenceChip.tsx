'use client'

import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import {
  confidenceLabel,
  confidenceToneClasses,
  type ConfidenceLevel,
} from '@/lib/confidence'

interface ConfidenceChipProps {
  level: ConfidenceLevel
  /** Optional spread value (e.g. `±1.2°`) shown to the right of the
   *  label. Pre-formatted by the caller. */
  spreadLabel?: string
  className?: string
}

/**
 * Pill-shaped badge for ensemble confidence. Used by the big
 * "Tiempo actual" card to surface both the level and the spread
 * ("±1.2°"), and by the AirConditionsGrid to surface the rain
 * probability calibration. Marked `aria-live="polite"` so the screen
 * reader announces changes after the user opens the page.
 */
export default function ConfidenceChip({ level, spreadLabel, className }: ConfidenceChipProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]
  return (
    <span
      aria-live="polite"
      title={s.confidenceTooltip}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${confidenceToneClasses(level)} ${className ?? ''}`}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
      {confidenceLabel(level, locale)}
      {spreadLabel ? <span className="opacity-80">{spreadLabel}</span> : null}
    </span>
  )
}

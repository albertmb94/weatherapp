'use client'

/**
 * Sprint 13: `ProfileChip` — small badge rendered inside
 * `FriendlyHome` next to the "Tiempo actual" card.
 *
 * The chip surfaces the auto-derived profile (e.g. "Costero") so the
 * user can see at a glance which terrain-aware weighting is
 * currently biasing the ensemble. When the backtest hasn't written
 * any rows for that terrain, the chip falls back to the neutral
 * label ("Sin sesgo regional"). When `profile === null` (the
 * classifier is still in flight), the chip renders nothing — we
 * don't want to flash a placeholder.
 *
 * The component is non-interactive: no onClick, no tooltip-with-
 * actions. It is purely informational and matches the visual
 * weight of the existing `ConfidenceChip` next to it.
 */

import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import {
  PROFILE_LABELS,
  PROFILE_LABELS_EN,
  type UsageProfile,
} from '@/lib/profiles'

interface ProfileChipProps {
  profile: UsageProfile | null
  /** How many backtest-recommended models are currently being
   *  boosted (intersection of the recommendation with the user's
   *  active set). Zero or null means no boost is being applied;
   *  the chip falls back to the neutral label. */
  boostedCount?: number | null
  className?: string
}

export default function ProfileChip({
  profile,
  boostedCount = 0,
  className,
}: ProfileChipProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]
  if (profile === null) return null
  const label = locale === 'en' ? PROFILE_LABELS_EN[profile] : PROFILE_LABELS[profile]
  const boosted = (boostedCount ?? 0) > 0 && profile !== 'plain'
  const trailing = boosted
    ? `${boostedCount} ${locale === 'en' ? 'models' : 'modelos'}`
    : s.profileChipNeutral
  return (
    <span
      aria-label={`${s.profileChipPrefix}: ${label} · ${trailing}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border-border bg-surface-popover text-text-secondary ${className ?? ''}`}
    >
      <span>{s.profileChipPrefix}:</span>
      <span className="text-text-primary">{label}</span>
      <span className="opacity-70" aria-hidden="true">·</span>
      <span className="opacity-80">{trailing}</span>
    </span>
  )
}
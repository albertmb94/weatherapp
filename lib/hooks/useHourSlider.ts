/**
 * useHourSlider — derive the safe bounds for the hour slider from the
 * URL state and the current view.
 *
 * Pure derivation hook: it does not own any state itself and does not
 * call `updateUrl`. Callers compose it with `useUrlState` and pass the
 * returned `safeSelectedHour` to the UI.
 *
 * Extracted from `app/home-content.tsx` during Sprint 10 to keep the
 * hour-clamping logic in one testable place. Behaviour is preserved
 * exactly: marine_global is excluded from the model-hour calculation
 * (M12) and the slider clamps to `[0, max(1, min(range, maxModel, len)) - 1]`.
 */
import { useMemo } from 'react'
import { MODELS } from '@/lib/models'

export interface UseHourSliderArgs {
  /** Raw hour index from the URL state (view-relative). */
  selectedHour: number
  /** Forecast range in hours from the URL state. */
  selectedRange: number
  /** Selected model IDs from the URL state. */
  selectedModels: string[]
  /** Length of the trimmed view series (may be 0 before data loads). */
  viewTimesLength: number
}

export interface UseHourSliderResult {
  /** Maximum forecast horizon across the selected non-marine models. */
  maxModelHours: number
  /** Effective cap = min(range, maxModelHours, viewTimesLength). */
  effectiveMaxHours: number
  /** selectedHour clamped to [0, effectiveMaxHours - 1]. */
  safeSelectedHour: number
}

export function useHourSlider({
  selectedHour,
  selectedRange,
  selectedModels,
  viewTimesLength,
}: UseHourSliderArgs): UseHourSliderResult {
  const maxModelHours = useMemo(() => {
    if (selectedModels.length === 0) return 336
    // M12: exclude marine_global from the maxModelHours calculation.
    // marine_global.maxHours is 0 (a placeholder), so if it's the only
    // model the slider would clamp to 0 and the UI breaks. Marine data
    // uses its own forecast_days anyway.
    const land = selectedModels.filter(id => id !== 'marine_global')
    if (land.length === 0) return 336
    return Math.max(
      ...land.map(id => MODELS.find(m => m.id === id)?.maxHours ?? 168)
    )
  }, [selectedModels])

  // Without a view we still need a non-zero floor so the slider
  // doesn't render `max=-1`. Use 1 as the absolute minimum.
  const timeLen = Math.max(0, viewTimesLength)
  const effectiveMaxHours = Math.max(
    1,
    Math.min(selectedRange, maxModelHours, timeLen || selectedRange)
  )
  const safeSelectedHour = Math.max(
    0,
    Math.min(selectedHour, effectiveMaxHours - 1)
  )

  return { maxModelHours, effectiveMaxHours, safeSelectedHour }
}

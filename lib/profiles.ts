/**
 * Profile definitions for the weather app.
 *
 * The profile is **derived automatically** from the location's terrain
 * (see `lib/backtest/classifyTerrain.ts`); the user never sees a manual
 * selector in the UI. The "preferred models" list per profile used to
 * live here as a hardcoded table; it now comes from the backtest
 * database (`getModelAccuracyByTerrain`) so the recommendation
 * reflects the actual historical accuracy of each model on that
 * terrain type, lead-time and metric — not a static guess.
 *
 * What this module still owns:
 *   - The enum of profiles (`UsageProfile`) and their display labels.
 *   - The mapping from `TerrainType` (6 categories, including island
 *     and river_valley) to a `UsageProfile` (4 categories).
 *   - A pure `deriveProfileFromTerrain()` helper used by
 *     `useEffectiveProfile` in the browser.
 *
 * What this module does NOT own anymore:
 *   - The list of preferred models per profile. That is read at
 *     runtime via `getModelAccuracyByTerrain()` so the recommendation
 *     tracks the actual model_accuracy table written by the weekly
 *     backtest job.
 */

import type { TerrainClassification } from '@/lib/backtest/classifyTerrain'

export type UsageProfile =
  | 'plain'
  | 'coastal'
  | 'mountain'
  | 'urban'

export const PROFILE_ORDER: UsageProfile[] = [
  'plain',
  'coastal',
  'mountain',
  'urban',
]

export const PROFILE_LABELS: Record<UsageProfile, string> = {
  plain: 'Llanura',
  coastal: 'Costero',
  mountain: 'Montaña',
  urban: 'Urbano',
}

export const PROFILE_LABELS_EN: Record<UsageProfile, string> = {
  plain: 'Plain',
  coastal: 'Coastal',
  mountain: 'Mountain',
  urban: 'Urban',
}

/**
 * Map a `TerrainClassification` (the raw output of `classifyTerrain`)
 * to a `UsageProfile`. The mapping collapses the 6 terrain types down
 * to 4 user-facing profiles:
 *
 *   - mountain        → mountain
 *   - island | coastal → coastal  (islands behave like coastal cities
 *                                for ensemble weighting purposes; the
 *                                underlying data already separates
 *                                them, so we keep both source rows)
 *   - urban           → urban
 *   - flat | river_valley → plain (low-elevation inland; the
 *                                agricultural profile was collapsed
 *                                into plain because we no longer
 *                                support a separate selector)
 *
 * When the classifier is uncertain (`confidence < 0.6`) we fall back
 * to plain. Plain never applies a profile boost; it's the "we don't
 * know" profile and behaves identically to the un-profiled baseline.
 */
export function deriveProfileFromTerrain(
  terrain: TerrainClassification
): UsageProfile {
  if (terrain.confidence < 0.6) return 'plain'
  switch (terrain.type) {
    case 'mountain':
      return 'mountain'
    case 'island':
    case 'coastal':
      return 'coastal'
    case 'urban':
      return 'urban'
    case 'flat':
    case 'river_valley':
    default:
      return 'plain'
  }
}

/**
 * Pure equality helper for the few render-cycle places that compare
 * a previously cached profile to the freshly-derived one. Returns
 * true when both inputs are the same string — the `UsageProfile` type
 * is a string literal union, so a plain `===` would also work but
 * we keep this function to make the intent explicit at call sites.
 */
export function profilesAreEqual(a: UsageProfile | null, b: UsageProfile | null): boolean {
  return a === b
}

/**
 * Placeholder kept so any third-party import that still references
 * the previous `ProfileRecommendation` interface does not crash.
 * The field is no longer consumed anywhere in the app — the boost
 * logic now reads from `getModelAccuracyByTerrain`.
 *
 * @deprecated since 2026-07-26 (Sprint 13). Hardcoded preferences
 * have been replaced by the weekly backtest.
 */
export interface ProfileRecommendation {
  /** @deprecated */
  preferredModels: string[]
  /** @deprecated */
  preferMarine: boolean
  /** @deprecated */
  preferLongRange: boolean
  /** @deprecated */
  descriptionEs: string
  /** @deprecated */
  descriptionEn: string
}

/**
 * Returns a minimal `ProfileRecommendation` stub for callers that
 * still expect the shape. All fields are empty/neutral so the
 * historical callers (none, at this point) get a safe no-op.
 *
 * @deprecated since 2026-07-26 (Sprint 13). The recommendation is
 * now computed from `model_accuracy`.
 */
export function getProfileRecommendation(): ProfileRecommendation {
  return {
    preferredModels: [],
    preferMarine: false,
    preferLongRange: false,
    descriptionEs: '',
    descriptionEn: '',
  }
}
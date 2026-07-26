/**
 * Central ensemble logic — single source of truth for "what does the
 * ensemble temperature at hour H look like?".
 *
 * Before this module, four call sites computed their own weighted
 * average with subtle differences:
 *   - `friendlyForecast.computeCurrentSnapshot` filtered by `activeIds`
 *   - `friendlyForecast.computeHourlySlots`  filtered by `activeIds`
 *   - `InsightsTable` filtered by `activeIds` OR by `ensembleMode`
 *   - `DailySummary` filtered by `activeIds`
 *
 * The result was that the big "Tiempo actual" card, the "AHORA" slot
 * of the hourly strip and the active row of the Insights table could
 * display three different numbers for the same hour. The user noticed
 * and reported B-10-1.
 *
 * This module exposes one canonical set of helpers:
 *
 *   resolveActiveModels()  — which models participate in the ensemble
 *   weightsFor()           — the per-model weight vector for a given
 *                             metric and lead-time bucket
 *   meanAtHour()           — single-hour weighted average
 *   meanOverBucket()       — multi-hour (bucket) weighted average
 *
 * Product rule (Sprint 10): the "current hour" calculation is always
 * the WedAI ensemble (all non-marine models), independent of the
 * user's `selectedIds`. The user's manual selection still drives the
 * rest of the table / chart (DailySummary non-current rows, etc).
 */

import type { WeatherModel, MetricId } from '../models'
import {
  ENSEMBLE_PRESETS,
  METRIC_TO_ENSEMBLE,
  getLeadTimeBucket,
} from '../models'
import { weightedAvg } from '../ensemble'

export type EnsembleMode = 'wedai' | 'models'

/** A single time-series bucket (full forecast or marine payload). */
export interface SeriesBag {
  time: Date[]
  series: Record<string, Record<string, (number | null)[]>>
}

/**
 * Resolve the set of models that participate in an ensemble calculation.
 *
 * Rules (mirrors the original InsightsTable logic exactly so we don't
 * change which models count as "land"):
 *   - marine_global is ALWAYS excluded (it's a virtual marine-only
 *     model, never asked of the land forecast API).
 *   - `mode === 'wedai'`: every remaining model participates, regardless
 *     of which the user toggled in Models mode. This is the canonical
 *     "best estimate" the product wants surfaced everywhere.
 *   - `mode === 'models'`: only the user-selected ids participate.
 *
 * The result is a NEW array; the input is not mutated. Order is the
 * order of `allModels` (which is stable across the project).
 */
export function resolveActiveModels(
  allModels: WeatherModel[],
  selectedIds: string[],
  mode: EnsembleMode
): WeatherModel[] {
  const land = allModels.filter(m => m.id !== 'marine_global')
  if (mode === 'wedai') return land
  const set = new Set(selectedIds)
  return land.filter(m => set.has(m.id))
}

/**
 * Build the per-model weight vector for a metric at a given lead time.
 *
 * The weight for each model is sourced from the ensemble preset's
 * bucket matching the lead time. Models not present in the preset
 * get the 0.01 fallback (kept small but non-zero so they don't get
 * silently dropped). The returned array is aligned with
 * `activeModels` order.
 *
 * `bucketHours` matters for InsightsTable, where a row covering N
 * hours may want the "mid-row" lead time: pass `bucketHours` and we
 * use `hourIndex * bucketHours` as the lead time. For single-hour
 * helpers pass `bucketHours = 1`.
 */
export function weightsFor(
  metric: MetricId,
  hourIndex: number,
  bucketHours: number,
  activeModels: WeatherModel[]
): number[] {
  const presetId = METRIC_TO_ENSEMBLE[metric] ?? 'temperature'
  const preset = ENSEMBLE_PRESETS.find(p => p.id === presetId) ?? ENSEMBLE_PRESETS[0]
  const leadTimeHours = Math.max(0, hourIndex) * Math.max(1, bucketHours)
  const leadBucket = getLeadTimeBucket(leadTimeHours)
  const bucketWeights = preset.weights[leadBucket] ?? preset.weights['0-48h']
  return activeModels.map(m => bucketWeights[m.id] ?? 0.01)
}

/**
 * Same as `weightsFor`, but takes an ABSOLUTE hour index (already
 * offset by `startIndex`). Use this in callers that consume a
 * trimmed `viewTimes` and need their bucket to match the
 * UTC-fake-local absolute hour (so a forecast opened at 14:30
 * gives rows that span 14–48h the bucket `0-48h` instead of
 * mis-tagging them with bucket `0-48h` again based on a
 * `hourIndex * bucket` starting at zero).
 */
export function weightsForAbsolute(
  metric: MetricId,
  absoluteHour: number,
  bucketHours: number,
  activeModels: WeatherModel[]
): number[] {
  // Mid-row lead time: the centre of the bucket produces the same
  // preset selection as `weightsFor`. We use absoluteHour as the
  // starting point and add the row's mid-bucket lead time so a
  // bucket covering 14–26h with `startIndex=14` selects the
  // `0-48h` preset rather than `96-168h`.
  const safeBucket = Math.max(1, bucketHours)
  const leadTimeHours = Math.max(0, absoluteHour) + (safeBucket - 1) / 2
  // Reuse the canonical bucket lookup.
  return weightsFor(metric, leadTimeHours, 1, activeModels)
}

/**
 * Weighted average of `metric` at a single `hourIndex` across the
 * models in `activeModels`, using the supplied `weights` vector
 * (from `weightsFor`). Returns null when no model contributes.
 *
 * The weights MUST be aligned with `activeModels` (callers should
 * always go through `weightsFor`). This function does NOT re-derive
 * them so the test suite can pin both inputs.
 */
export function meanAtHour(
  bag: SeriesBag,
  metric: MetricId,
  hourIndex: number,
  activeModels: WeatherModel[],
  weights: number[]
): number | null {
  if (activeModels.length === 0) return null
  const vals = activeModels.map(
    m => bag.series[m.id]?.[metric]?.[hourIndex] ?? null
  )
  return weightedAvg(vals, weights)
}

/**
 * Weighted average of `metric` over a contiguous range of hours
 * (`startIdx..endIdx` inclusive) using per-hour weights (some
 * callers want to vary weights by hour, e.g. bucket=24 where the
 * mid-day row may want different weights than the night row).
 *
 * For constant-weight buckets pass `weightsFor(metric, 0, 1, activeModels)`
 * once and reuse it via a closure `() => weights`.
 */
export function meanOverBucket(
  bag: SeriesBag,
  metric: MetricId,
  startIdx: number,
  endIdx: number,
  activeModels: WeatherModel[],
  weightsForHour: (hourIndex: number) => number[]
): number | null {
  if (activeModels.length === 0) return null
  if (startIdx > endIdx) return null
  let sum = 0
  let wSum = 0
  for (let i = startIdx; i <= endIdx; i++) {
    const weights = weightsForHour(i)
    const vals = activeModels.map(
      m => bag.series[m.id]?.[metric]?.[i] ?? null
    )
    const v = weightedAvg(vals, weights)
    if (v !== null) {
      // Equal weight per hour: each hour contributes 1/N so the
      // resulting average is the simple mean of the per-hour
      // ensembles. This matches the previous InsightsTable behaviour.
      sum += v
      wSum += 1
    }
  }
  return wSum > 0 ? sum / wSum : null
}

/** Convenience: build a constant-weight function from a single vector. */
export function constantWeights(weights: number[]): (hourIndex: number) => number[] {
  return () => weights
}

/**
 * B-NEW-6 (2026-07-24): compute a per-hour ensemble mean that falls
 * back to the full WedAI ensemble when the user's selection returns
 * no data for that hour.
 *
 * The previous InsightsTable loop called `weightedAvg` directly with
 * the user's `activeModels`. After the long-range model filter in
 * `lib/openMeteo.ts` (B-NEW-3) the production API only returns 5
 * long-range models, so a user who has selected only a short-range
 * model like `meteofrance_arome_france_hd` sees every cell go to
 * null even though the underlying data is in the series. The
 * friendly cards (`computeHourlySlots`, `computeWeekSummaries`)
 * already had this fallback via `meanAcrossModels`; this helper
 * exposes the same logic for the InsightsTable's inline loops
 * without duplicating the per-metric weight construction.
 *
 * B-NEW-9 (2026-07-24, hotfix): the previous version of this
 * function computed the fallback weights as
 *   `allLandModels.map((_, i) => weights[i] ?? 0.01)`
 * which silently reused the user's weights for the first model
 * in the fallback set and gave every other model a near-zero
 * weight. If the user had selected a single model and its series
 * was missing for some hour, the fallback would always be
 * dominated by whichever model happened to be first in
 * `allLandModels` — different single-model selections produced
 * the *same* fallback number, which is exactly the
 * "muchos modelos muestran exactamente los mismos valores"
 * the user reported. The fix recomputes the weights for the
 * fallback set using the same preset lookup (`weightsFor`) the
 * rest of the table uses, so the fallback is a real calibrated
 * mean of all 19 land models rather than a hack reusing
 * 1-element user weights.
 */
export function ensembleWithFallback(
  series: Record<string, Record<string, (number | null)[]>>,
  metric: string,
  index: number,
  activeModels: WeatherModel[],
  allLandModels: WeatherModel[],
  weights: number[]
): number | null {
  if (activeModels.length === 0) return null
  const v = meanAtHourFromSeries(series, metric as MetricId, index, activeModels, weights)
  if (v !== null) return v
  // The user's selection returned null — fall back to WedAI so the
  // user always sees data when at least one model has a value.
  // Recompute the weights for the fallback set from the preset,
  // not from `weights` (which is aligned with `activeModels` and
  // may be much shorter). Without this, a 1-element user
  // selection would produce a 19-element fallback array with the
  // user's weight re-applied to the first fallback model and
  // 0.01 to the rest — wrong AND identical across selections.
  if (allLandModels.length === 0) return null
  const fallbackWeights = weightsFor(metric as MetricId, index, 1, allLandModels)
  return meanAtHourFromSeries(series, metric as MetricId, index, allLandModels, fallbackWeights)
}

/**
 * Like `meanAtHour` but takes the series map directly instead of a
 * `SeriesBag`. Lets the InsightsTable pass its `series` prop without
 * wrapping it in `{ series }`.
 */
function meanAtHourFromSeries(
  series: Record<string, Record<string, (number | null)[]>>,
  metric: MetricId,
  hourIndex: number,
  activeModels: WeatherModel[],
  weights: number[]
): number | null {
  if (activeModels.length === 0) return null
  const vals = activeModels.map(
    m => series[m.id]?.[metric]?.[hourIndex] ?? null
  )
  return weightedAvg(vals, weights)
}

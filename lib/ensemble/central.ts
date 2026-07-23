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

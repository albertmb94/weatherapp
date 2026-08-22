/**
 * B-NBT-6 (2026-08-22): step 3 of the backtest (dynamic weights) used
 * to live inline in scripts/runBacktest.ts where a single SQLITE_BUSY
 * — trivial to trigger when any other process (dev server, another
 * script) holds the local.db write lock — aborted the whole run with a
 * fatal LibsqlError. This module owns the logic so both the CLI script
 * and targeted retries share it, wraps every cell in its own try/catch
 * (one locked cell no longer kills the remaining thousands), and
 * retries transient lock errors with a short backoff.
 */

import { computeDynamicWeights } from './computeDynamicWeights'
import { getModelAccuracy, insertDynamicWeights, type DynamicWeightRow } from './db'
import {
  BACKTEST_LOCATIONS,
  BACKTEST_METRICS,
  LEAD_TIME_BUCKETS,
  type BacktestLocation,
} from './config'

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 750

function isBusyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /SQLITE_BUSY|database is locked/i.test(msg)
}

async function insertWithRetry(rows: DynamicWeightRow[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await insertDynamicWeights(rows)
      return
    } catch (err) {
      if (attempt >= MAX_RETRIES || !isBusyError(err)) throw err
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt))
    }
  }
}

/**
 * Compute inverse-RMSE dynamic weights for every
 * location × metric × lead-time bucket and store them in the
 * `dynamic_weights` table. Returns the number of rows stored.
 */
export async function storeDynamicWeights(
  locations: readonly BacktestLocation[] = BACKTEST_LOCATIONS,
): Promise<{ stored: number; failedCells: string[] }> {
  let stored = 0
  const failedCells: string[] = []

  for (const location of locations) {
    for (const metric of BACKTEST_METRICS) {
      for (const bucket of LEAD_TIME_BUCKETS) {
        try {
          const accuracyRecords = await getModelAccuracy(
            location.lat,
            location.lon,
            location.terrain,
            metric,
            bucket,
          )
          if (accuracyRecords.length === 0) continue

          const dynamicWeights = computeDynamicWeights(accuracyRecords)
          if (Object.keys(dynamicWeights).length === 0) continue

          const weightRows: DynamicWeightRow[] = Object.entries(dynamicWeights).map(
            ([modelId, weight]) => ({
              lat: location.lat,
              lon: location.lon,
              terrain_type: location.terrain,
              model_id: modelId,
              metric,
              weight,
              lead_time_bucket: bucket,
            }),
          )

          await insertWithRetry(weightRows)
          stored += weightRows.length
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          failedCells.push(`${location.name}/${metric}/${bucket}: ${msg}`)
        }
      }
    }
  }

  return { stored, failedCells }
}

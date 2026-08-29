/**
 * Weekly backtest orchestrator.
 * Fetches historical forecasts and ERA5 observations, computes verification
 * metrics, and stores results in the database.
 *
 * Designed to run as a serverless cron job (e.g. Vercel Cron or similar).
 */

import {
  ensureBacktestSchema,
  insertForecastArchive,
  insertObservations,
  insertModelAccuracy,
  type ModelAccuracyRow,
} from './db'
import { fetchPreviousRuns } from './fetchPreviousRuns'
import { fetchERA5Observations } from './fetchERA5'
import { leadTimeBucket } from './fetchPreviousRuns'
import { computeMetrics } from './computeMetrics'
import {
  BACKTEST_LOCATIONS,
  type BacktestLocation,
} from './config'

interface BacktestProgress {
  total: number
  completed: number
  errors: string[]
}

/**
 * Run the weekly backtest for all reference locations.
 * Fetches the last 7 days of forecasts and observations.
 *
 * `locations` defaults to the full BACKTEST_LOCATIONS set; passing a
 * subset lets callers retry individual failures (B-NBT-6) without
 * re-fetching the whole grid.
 */
export async function runWeeklyBacktest(
  signal?: AbortSignal,
  locations: readonly BacktestLocation[] = BACKTEST_LOCATIONS,
): Promise<BacktestProgress> {
  await ensureBacktestSchema()

  const progress: BacktestProgress = {
    total: locations.length,
    completed: 0,
    errors: [],
  }

  // Calculate date range: last 7 days, computed in absolute ms
  // (not via `setDate`) so DST boundaries in the host timezone
  // can't shift the window by an hour.
  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - 7 * 86_400_000)

  const startDateStr = startDate.toISOString().slice(0, 10)
  const endDateStr = endDate.toISOString().slice(0, 10)

  console.log(`[backtest] Starting weekly backtest: ${startDateStr} to ${endDateStr}`)

  for (const location of locations) {
    try {
      // Fetch forecasts and observations in parallel
      const [forecastRows, observationRows] = await Promise.all([
        fetchPreviousRuns(location, startDateStr, endDateStr, signal),
        fetchERA5Observations(location, startDateStr, endDateStr, signal),
      ])

      // Store raw data
      await insertForecastArchive(forecastRows)
      await insertObservations(observationRows)

      // Compute and store accuracy metrics
      const accuracyRows = computeAccuracyFromRaw(
        location,
        forecastRows,
        observationRows,
        startDateStr,
        endDateStr
      )
      await insertModelAccuracy(accuracyRows)

      progress.completed++
      console.log(`[backtest] ${location.name} (${location.country}) completed: ${forecastRows.length} forecast rows, ${observationRows.length} observation rows, ${accuracyRows.length} accuracy rows`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      progress.errors.push(`${location.name}: ${msg}`)
      console.error(`[backtest] Error for ${location.name}: ${msg}`)
    }
  }

  console.log(`[backtest] Completed: ${progress.completed}/${progress.total} locations, ${progress.errors.length} errors`)
  return progress
}

/**
 * Compute accuracy metrics from raw forecast and observation data.
 *
 * B-NBT-2 (2026-08-22): verification pairs every forecast row with the
 * observation recorded at the forecast's VALID time — predicted(valid)
 * vs observed(valid). The previous implementation paired against the
 * observation at `init_time` (when the forecast was issued), which does
 * not measure forecast skill at all: it compares "what the model
 * predicted for hour H" with "the weather that was happening when the
 * run started". That deflated every bucket and made long leads look
 * arbitrarily bad. There is no leakage concern in pairing at valid
 * time: leakage would only arise if we *selected* rows using future
 * information, which we don't — the previous_dayN payload is fixed by
 * the provider.
 */
export function computeAccuracyFromRaw(
  location: BacktestLocation,
  forecastRows: { model_id: string; init_time: string; valid_time: string; metric: string; predicted_value: number | null; lead_time_hours: number }[],
  observationRows: { valid_time: string; metric: string; observed_value: number | null }[],
  windowStart: string,
  windowEnd: string
): ModelAccuracyRow[] {
  const results: ModelAccuracyRow[] = []

  // Build observation lookup: `${valid_time}|${metric}` -> observed_value
  const obsMap = new Map<string, number>()
  for (const row of observationRows) {
    if (row.observed_value !== null) {
      obsMap.set(`${row.valid_time}|${row.metric}`, row.observed_value)
    }
  }

  // Group forecasts by model, metric, and lead time bucket.
  const grouped = new Map<string, { predicted: number[]; observed: number[] }>()
  for (const row of forecastRows) {
    if (row.predicted_value === null) continue
    const bucket = leadTimeBucket(row.lead_time_hours)
    const key = `${row.model_id}|${row.metric}|${bucket}`
    const obsKey = `${row.valid_time}|${row.metric}`
    const observed = obsMap.get(obsKey)
    if (observed === undefined) continue

    if (!grouped.has(key)) {
      grouped.set(key, { predicted: [], observed: [] })
    }
    grouped.get(key)!.predicted.push(row.predicted_value)
    grouped.get(key)!.observed.push(observed)
  }

  // Compute metrics for each group
  for (const [key, { predicted, observed }] of grouped) {
    const [modelId, metric, bucket] = key.split('|')
    const metrics = computeMetrics(predicted, observed, metric)
    if (metrics.sampleCount === 0) continue

    results.push({
      model_id: modelId,
      lat: location.lat,
      lon: location.lon,
      terrain_type: location.terrain,
      metric,
      lead_time_bucket: bucket,
      mae: metrics.mae,
      rmse: metrics.rmse,
      bias: metrics.bias,
      sample_count: metrics.sampleCount,
      window_start: windowStart,
      window_end: windowEnd,
      computed_at: new Date().toISOString(),
    })
  }

  return results
}

/**
 * Convenience function for API route invocation.
 */
export async function handleBacktestRequest(): Promise<Response> {
  // Aquí se leía la IP del llamante para escribirla en el log
  // (`console.log('[backtest] Request from ...')`). Eso dejaba
  // direcciones IP en los logs de Vercel, justo lo que el resto de la app
  // evita: /api/consent-stats no las persiste y la analítica trabaja con
  // un pseudónimo. Y no servía para nada más — no había ningún rate limit
  // que la usara. Esta ruta la protege `BACKTEST_SECRET` con comparación
  // en tiempo constante (app/api/backtest/route.ts), así que tampoco hace
  // falta acotar por IP.

  try {
    const progress = await runWeeklyBacktest()
    return Response.json({
      success: true,
      progress,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[backtest] Fatal error: ${message}`)
    return Response.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

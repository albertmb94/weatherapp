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
  BACKTEST_METRICS,
  LEAD_TIME_BUCKETS,
  BACKTEST_MODEL_IDS,
  type BacktestLocation,
  type TerrainType,
} from './config'

interface BacktestProgress {
  total: number
  completed: number
  errors: string[]
}

/**
 * Run the weekly backtest for all reference locations.
 * Fetches the last 7 days of forecasts and observations.
 */
export async function runWeeklyBacktest(signal?: AbortSignal): Promise<BacktestProgress> {
  await ensureBacktestSchema()

  const progress: BacktestProgress = {
    total: BACKTEST_LOCATIONS.length,
    completed: 0,
    errors: [],
  }

  // Calculate date range: last 7 days
  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - 7)

  const startDateStr = startDate.toISOString().slice(0, 10)
  const endDateStr = endDate.toISOString().slice(0, 10)

  console.log(`[backtest] Starting weekly backtest: ${startDateStr} to ${endDateStr}`)

  for (const location of BACKTEST_LOCATIONS) {
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
 */
function computeAccuracyFromRaw(
  location: BacktestLocation,
  forecastRows: { model_id: string; valid_time: string; metric: string; predicted_value: number | null; lead_time_hours: number }[],
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

  // Group forecasts by model, metric, and lead time bucket
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
    })
  }

  return results
}

/**
 * Convenience function for API route invocation.
 */
export async function handleBacktestRequest(request: Request): Promise<Response> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  console.log(`[backtest] Request from ${ip}`)

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

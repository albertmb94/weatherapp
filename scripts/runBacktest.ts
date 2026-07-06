/**
 * Local backtest execution script.
 * Run with: npx tsx scripts/runBacktest.ts
 *
 * Fetches historical forecasts and ERA5 observations for all reference
 * locations, computes verification metrics, and stores results in the DB.
 */

import { runWeeklyBacktest } from '../lib/backtest/runWeeklyBacktest'
import { computeDynamicWeights, mergeWeights } from '../lib/backtest/computeDynamicWeights'
import { insertDynamicWeights, getModelAccuracy } from '../lib/backtest/db'
import { ensureBacktestSchema } from '../lib/backtest/db'
import { BACKTEST_LOCATIONS, BACKTEST_METRICS, LEAD_TIME_BUCKETS } from '../lib/backtest/config'
import type { DynamicWeightRow } from '../lib/backtest/db'

async function main() {
  console.log('=== Weather App Backtest ===')
  console.log(`Locations: ${BACKTEST_LOCATIONS.length}`)
  console.log(`Metrics: ${BACKTEST_METRICS.join(', ')}`)
  console.log(`Lead time buckets: ${LEAD_TIME_BUCKETS.join(', ')}`)
  console.log('')

  // Step 1: Ensure DB schema
  console.log('[1/3] Ensuring database schema...')
  await ensureBacktestSchema()

  // Step 2: Run the weekly backtest
  console.log('[2/3] Running weekly backtest...')
  const progress = await runWeeklyBacktest()

  console.log('')
  console.log('Backtest Results:')
  console.log(`  Completed: ${progress.completed}/${progress.total} locations`)
  console.log(`  Errors: ${progress.errors.length}`)
  if (progress.errors.length > 0) {
    console.log('  Error details:')
    for (const err of progress.errors) {
      console.log(`    - ${err}`)
    }
  }

  // Step 3: Compute and store dynamic weights
  console.log('')
  console.log('[3/3] Computing dynamic weights...')
  let totalWeightRows = 0

  for (const location of BACKTEST_LOCATIONS) {
    for (const metric of BACKTEST_METRICS) {
      for (const bucket of LEAD_TIME_BUCKETS) {
        const accuracyRecords = await getModelAccuracy(
          location.lat,
          location.lon,
          location.terrain,
          metric,
          bucket
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
          })
        )

        await insertDynamicWeights(weightRows)
        totalWeightRows += weightRows.length
      }
    }
  }

  console.log(`  Stored ${totalWeightRows} dynamic weight rows`)
  console.log('')
  console.log('=== Backtest Complete ===')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

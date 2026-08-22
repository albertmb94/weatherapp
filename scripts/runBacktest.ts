/**
 * Local backtest execution script.
 * Run with: npx tsx scripts/runBacktest.ts
 *
 * Fetches historical forecasts and ERA5 observations for all reference
 * locations, computes verification metrics, and stores results in the DB.
 */

import { runWeeklyBacktest } from '../lib/backtest/runWeeklyBacktest'
import { storeDynamicWeights } from '../lib/backtest/storeDynamicWeights'
import {
  BACKTEST_LOCATIONS,
  BACKTEST_METRICS,
  LEAD_TIME_BUCKETS,
} from '../lib/backtest/config'

async function main() {
  console.log('=== Weather App Backtest ===')
  console.log(`Locations: ${BACKTEST_LOCATIONS.length}`)
  console.log(`Metrics: ${BACKTEST_METRICS.join(', ')}`)
  console.log(`Lead time buckets: ${LEAD_TIME_BUCKETS.join(', ')}`)
  console.log('')

  // Step 1: Ensure DB schema
  console.log('[1/3] Ensuring database schema...')
  const { ensureBacktestSchema } = await import('../lib/backtest/db')
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

  // Step 3: Compute and store dynamic weights. B-NBT-6: each
  // location × metric × bucket cell is retried/isolated inside
  // storeDynamicWeights so a transient SQLITE_BUSY can no longer
  // abort the whole run.
  console.log('')
  console.log('[3/3] Computing dynamic weights...')
  const { stored, failedCells } = await storeDynamicWeights()
  console.log(`  Stored ${stored} dynamic weight rows`)
  if (failedCells.length > 0) {
    console.log(`  Failed cells: ${failedCells.length}`)
    for (const cell of failedCells) {
      console.log(`    - ${cell}`)
    }
  }
  console.log('')
  console.log('=== Backtest Complete ===')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

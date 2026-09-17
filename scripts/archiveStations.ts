#!/usr/bin/env tsx
/**
 * Archive real station observations into `station_observations`.
 *
 *   npx tsx --env-file=.env.local scripts/archiveStations.ts 2026-08-15 [2026-08-15]
 *
 * XEMA (Catalonia) is archived first: hourly, and it is the network whose
 * historical endpoint serves whole days per variable, so a bounded window
 * costs one request per (day × metric) plus one metadata call.
 */

import { ensureBacktestSchema, insertStationObservations } from '../lib/backtest/db'
import { fetchXemaObservations } from '../lib/backtest/fetchStations'

async function main() {
  const from = process.argv[2]
  const to = process.argv[3] ?? from
  if (!from) throw new Error('Usage: archiveStations.ts <from YYYY-MM-DD> [to YYYY-MM-DD]')

  const key = process.env.METEOCAT_API_KEY
  if (!key) throw new Error('METEOCAT_API_KEY is not configured')

  await ensureBacktestSchema()
  console.log(`[stations] XEMA ${from}..${to}`)
  const rows = await fetchXemaObservations(from, to, key, undefined, undefined, (m) => console.log(m))
  await insertStationObservations(rows)

  const byMetric = new Map<string, number>()
  for (const r of rows) byMetric.set(r.metric, (byMetric.get(r.metric) ?? 0) + 1)
  console.log(
    `[stations] ${rows.length} observaciones archivadas · ` +
      [...byMetric.entries()].map(([m, n]) => `${m}=${n}`).join(' '),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

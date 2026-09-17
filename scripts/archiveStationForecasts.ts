#!/usr/bin/env tsx
/**
 * Cache Previous-Runs forecasts at REAL station coordinates into
 * `forecast_archive`, so station-truth verification/calibration is
 * network-free and repeatable afterwards.
 *
 *   npx tsx --env-file=.env.local scripts/archiveStationForecasts.ts 2026-08-09 2026-08-22 40
 *
 * One Previous Runs request per station returns the whole window (all
 * leads), so the cost is ~1 request × stations, not × days.
 */

import { ensureBacktestSchema, getStationObservations, insertForecastArchive } from '../lib/backtest/db'
import { fetchPreviousRuns } from '../lib/backtest/fetchPreviousRuns'
import type { BacktestLocation } from '../lib/backtest/config'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const [from, to = from, maxStations = '40'] = process.argv.slice(2)
  if (!from) throw new Error('Usage: archiveStationForecasts.ts <from> <to> [maxStations]')

  await ensureBacktestSchema()
  const obs = await getStationObservations({
    from: `${from}T00:00`,
    to: `${to}T23:59`,
    sources: ['xema'],
  })

  // Distinct stations, deterministic order, capped.
  const seen = new Set<string>()
  const stations: { name: string; lat: number; lon: number }[] = []
  for (const row of obs) {
    const key = `${row.lat.toFixed(4)}|${row.lon.toFixed(4)}`
    if (seen.has(key)) continue
    seen.add(key)
    stations.push({ name: row.station_name ?? row.station_id, lat: row.lat, lon: row.lon })
  }
  // Spread the sample across the network instead of the first N.
  const step = Math.max(1, Math.floor(stations.length / Number(maxStations)))
  const chosen = stations.filter((_, i) => i % step === 0).slice(0, Number(maxStations))

  console.log(`[stations→forecast] ${from}..${to} · ${chosen.length} estaciones de ${stations.length}`)
  let stored = 0
  for (const st of chosen) {
    const location: BacktestLocation = { name: st.name, lat: st.lat, lon: st.lon, terrain: 'coastal', country: 'ES' }
    let rows
    try {
      rows = await fetchPreviousRuns(location, from, to)
    } catch (err) {
      console.warn(`  ${st.name}: ${(err as Error).message}`)
      await sleep(1500)
      continue
    }
    await insertForecastArchive(rows)
    stored += rows.length
    console.log(`  ${st.name}: ${rows.length} filas`)
    await sleep(300)
  }
  console.log(`[stations→forecast] ${stored} filas de forecast archivadas`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

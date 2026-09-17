#!/usr/bin/env tsx
/**
 * Station-truth evaluation (XEMA). Thin CLI over `runStationTruth`.
 *
 *   npx tsx --env-file=.env.local scripts/archiveStations.ts 2026-08-15 2026-08-16
 *   npm run eval:stations -- 2026-08-15 2026-08-15 temperature 10
 *
 * Requires the station window to be archived first (see archiveStations.ts).
 * For the ERA5-vs-station side-by-side use
 * `npm run eval:ensemble -- <metric> 5 --truth=both --from=... --to=...`.
 */

import { runStationTruth } from '../lib/backtest/stationVerify'

async function main() {
  const [from, to = from, metric = 'temperature', stations = '10'] = process.argv.slice(2)
  if (!from) throw new Error('Usage: evalAgainstStations.ts <from> [to] [metric] [stations]')

  const res = await runStationTruth({
    metric,
    from,
    to,
    maxStations: Number(stations),
    log: (m) => console.log(m),
  })

  console.log(`\nTRUTH = ESTACIÓN (XEMA) · ${res.metric} · estaciones=${res.stations} · instancias=${res.instances}`)
  for (const b of res.perBucket) {
    const cat =
      res.metric === 'precipitation'
        ? `  POD ${((b.preset.pod ?? 0) * 100).toFixed(0)}%  FAR ${((b.preset.far ?? 0) * 100).toFixed(0)}%  CSI ${((b.preset.csi ?? 0) * 100).toFixed(0)}%`
        : ''
    console.log(
      `  ${b.bucket}  preset(ERA5) RMSE ${b.preset.rmse.toFixed(3)} MAE ${b.preset.mae.toFixed(3)}  ` +
        `| station:skill RMSE ${b.stationCsi.rmse.toFixed(3)} MAE ${b.stationCsi.mae.toFixed(3)}  n=${b.preset.n}${cat}`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

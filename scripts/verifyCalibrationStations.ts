/** Independent station check, after temporal fitting. Credentials are used
 * only for XEMA; raw data is cached locally and is never committed. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import { fetchXemaObservations } from '../lib/backtest/fetchStations'
import { fetchPreviousRuns } from '../lib/backtest/fetchPreviousRuns'
import { BASELINE_ENSEMBLE_PRESETS, ENSEMBLE_PRESETS, getLeadTimeBucket } from '../lib/models'
import { ensembleError, type JoinedSample } from '../lib/backtest/evalEnsemble'
import type { ForecastArchiveRow, StationObservationRow } from '../lib/backtest/db'

const dir = '.recalibration-cache', from = '2026-10-19', to = '2026-11-01'
const metrics = ['temperature', 'precipitation', 'wind_speed']
async function main() {
  mkdirSync(dir, { recursive: true })
  const obsPath = `${dir}/xema-utc-hour-end-${from}-${to}.json.gz`
  let obs: StationObservationRow[]
  if (existsSync(obsPath)) obs = JSON.parse(gunzipSync(readFileSync(obsPath)).toString())
  else {
    const key = process.env.METEOCAT_API_KEY
    if (!key) throw new Error('METEOCAT_API_KEY missing')
    obs = await fetchXemaObservations(from, to, key, metrics, undefined, console.log)
    if (!obs.length) throw new Error('No validated complete-hour station observations')
    writeFileSync(obsPath, gzipSync(JSON.stringify(obs)))
  }
  const stations = [...new Map(obs.map(r => [r.station_id, r])).values()]
    .sort((a, b) => a.station_id.localeCompare(b.station_id))
  const chosen = stations.filter((_, i) => i % Math.max(1, Math.floor(stations.length / 12)) === 0).slice(0, 12)
  const samples: Record<string, JoinedSample[]> = {}
  for (const st of chosen) {
    const path = `${dir}/xema-forecast-v2-${st.station_id}-${from}-${to}.json.gz`
    let rows: ForecastArchiveRow[]
    if (existsSync(path)) rows = JSON.parse(gunzipSync(readFileSync(path)).toString())
    else {
      rows = await fetchPreviousRuns({ name: st.station_id, lat: st.lat, lon: st.lon, country: 'ES', terrain: 'coastal' }, from, to, undefined, { metrics })
      writeFileSync(path, gzipSync(JSON.stringify(rows)))
      await new Promise(r => setTimeout(r, 1500))
    }
    const observed = new Map(obs.filter(r => r.station_id === st.station_id).map(r => [`${r.metric}|${r.valid_time}`, r.observed_value]))
    const groups = new Map<string, JoinedSample>()
    for (const r of rows) {
      if (r.lead_time_hours === 0 || r.predicted_value === null) continue
      const truth = observed.get(`${r.metric}|${r.valid_time}`)
      if (truth === undefined || truth === null) continue
      const key = `${r.metric}|${getLeadTimeBucket(r.lead_time_hours)}|${r.valid_time}|${r.lead_time_hours}`
      const group = groups.get(key) ?? { observed: truth, byModel: {} }
      group.byModel[r.model_id] = r.predicted_value
      groups.set(key, group)
    }
    for (const [key, sample] of groups) {
      const cell = key.split('|').slice(0, 2).join('/')
      if (Object.keys(sample.byModel).length >= 3) (samples[cell] ??= []).push(sample)
    }
    console.log(`[station] ${st.station_id}: ${groups.size} aligned points`)
  }
  const cells = Object.fromEntries(Object.entries(samples).map(([key, rows]) => {
    const [metric, bucket] = key.split('/')
    return [key, {
      baseline: ensembleError(rows, BASELINE_ENSEMBLE_PRESETS.find(p => p.id === metric)!.weights[bucket]),
      release: ensembleError(rows, ENSEMBLE_PRESETS.find(p => p.id === metric)!.weights[bucket]),
    }]
  }))
  if (!Object.keys(cells).length) throw new Error('No station/forecast pairs')
  writeFileSync('docs/recalibration-stations-2026-11-08.json', JSON.stringify({ from, to, timeBasis: 'UTC; complete preceding-hour observations', stations: chosen.map(s => s.station_id), cells }, null, 2) + '\n')
  console.log(JSON.stringify(cells))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })

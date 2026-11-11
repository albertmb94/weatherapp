import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { fetchPreviousRuns } from '../lib/backtest/fetchPreviousRuns'
import { fetchXemaObservations } from '../lib/backtest/fetchStations'
import { ensembleError, type JoinedSample } from '../lib/backtest/evalEnsemble'
import { predictMembers } from '../lib/backtest/jointCalibration'
import { ensemblePresetWeights } from '../lib/ensemble/central'
import { rainFactor } from '../lib/ensemble/rainCalibration'
import { getLeadTimeBucket } from '../lib/models'
import { MODELS, METRICS } from '../lib/models'
import { buildForecastRequest, DEFAULT_FORECAST_DAYS } from '../lib/openMeteo'
import type { ForecastArchiveRow, StationObservationRow } from '../lib/backtest/db'
import { archiveDir } from './forecastAuditData'

const from = '2026-11-07'
const to = '2026-11-10'
const asOf = Date.parse('2026-11-11T00:00Z')
const targets = { WU: 'Badalona–Museu', X4: 'Barcelona–el Raval', WT: 'Malgrat' }

async function main() {
  const obsPath = `${archiveDir}/xema-rain-audit-${from}-${to}.json.gz`
  let observations: StationObservationRow[]
  if (existsSync(obsPath)) observations = JSON.parse(gunzipSync(readFileSync(obsPath)).toString())
  else {
    const key = process.env.METEOCAT_API_KEY
    if (!key) throw new Error('METEOCAT_API_KEY missing')
    observations = await fetchXemaObservations(from, to, key, ['precipitation'], undefined, console.log)
    if (!observations.length) throw new Error('No validated station observations')
    writeFileSync(obsPath, gzipSync(JSON.stringify(observations)))
  }
  const sites: Record<string, unknown> = {}
  for (const [id, name] of Object.entries(targets)) {
    const rows = observations.filter(r => r.station_id === id)
    if (!rows.length) { sites[name] = { note: 'No validated observations' }; continue }
    const { lat, lon } = rows[0]
    const path = `${archiveDir}/coastal-audit-${id}-${from}-${to}.json.gz`
    let forecast: ForecastArchiveRow[]
    if (existsSync(path)) forecast = JSON.parse(gunzipSync(readFileSync(path)).toString())
    else {
      forecast = await fetchPreviousRuns({ name, lat, lon, terrain: 'coastal', country: 'ES' }, from, to, undefined, { metrics: ['precipitation'] })
      if (forecast.length) writeFileSync(path, gzipSync(JSON.stringify(forecast)))
    }
    const truth = new Map(rows.map(r => [r.valid_time, r.observed_value]))
    const live = new Set(buildForecastRequest(lat, lon, MODELS, METRICS, DEFAULT_FORECAST_DAYS).capped.map(m => m.id))
    const samples = new Map<string, { lead: number; sample: JoinedSample }>()
    for (const row of forecast) {
      const observed = truth.get(row.valid_time)
      if (typeof observed !== 'number' || row.lead_time_hours < 24 || row.predicted_value === null || !live.has(row.model_id)) continue
      const key = `${row.valid_time}|${row.lead_time_hours}`
      const entry = samples.get(key) ?? { lead: row.lead_time_hours, sample: { observed, byModel: {} } }
      entry.sample.byModel[row.model_id] = row.predicted_value
      samples.set(key, entry)
    }
    const results: Record<string, unknown> = {}
    for (const lead of [24, 48, 72, 96, 120, 144, 168]) {
      const preset = ensemblePresetWeights('precipitation', getLeadTimeBucket(lead))
      const factor = rainFactor(lat, lon, lead, asOf)
      const paired = [...samples.values()].filter(row => row.lead === lead).flatMap(({ sample }) => {
        const weights = Object.fromEntries(Object.keys(sample.byModel).map(id => [id, preset[id] ?? 0.01]))
        const value = predictMembers(sample, weights)
        return value === null ? [] : [{ observed: sample.observed, byModel: { global: value, local: value * factor } }]
      })
      if (!paired.length) continue
      results[lead] = {
        factor, observedMm: paired.reduce((sum, row) => sum + row.observed, 0),
        globalMm: paired.reduce((sum, row) => sum + row.byModel.global, 0),
        localMm: paired.reduce((sum, row) => sum + row.byModel.local, 0),
        global: ensembleError(paired, { global: 1 }), local: ensembleError(paired, { local: 1 }),
      }
    }
    sites[name] = { observedHours: rows.length, latest: rows.at(-1)?.valid_time, results }
  }
  writeFileSync('docs/forecast-coastal-2026-11-11.json', JSON.stringify({ from, to, asOf, sites }, null, 2) + '\n')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

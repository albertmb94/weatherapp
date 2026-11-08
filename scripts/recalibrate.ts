/** Reproducible UTC collection + chronological train/inner-validation/test.
 * Raw per-location observations and forecasts stay in an ignored gzip cache.
 * No production database credentials are read or changed by this command. */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { BACKTEST_LOCATIONS } from '../lib/backtest/config'
import { fetchPreviousRuns } from '../lib/backtest/fetchPreviousRuns'
import { fetchERA5Observations } from '../lib/backtest/fetchERA5'
import { BASELINE_ENSEMBLE_PRESETS, getLeadTimeBucket, MODELS } from '../lib/models'
import { calibrateBucket, type TimedSample } from '../lib/backtest/temporalCalibration'
import { ensembleError } from '../lib/backtest/evalEnsemble'
import type { ForecastArchiveRow, ObservationRow } from '../lib/backtest/db'

const metrics = ['temperature', 'precipitation', 'wind_speed']
const names = ['Barcelona', 'Madrid', 'Valencia', 'Bilbao', 'Granada', 'Palma', 'Sevilla', 'Valladolid',
  'Paris', 'London', 'Berlin', 'Amsterdam', 'Rome', 'Zurich', 'New York', 'Chicago', 'Los Angeles', 'Toronto']
const locations = BACKTEST_LOCATIONS.filter(l => names.includes(l.name))
const flag = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const from = flag('from', '2026-09-20'), to = flag('to', '2026-11-01')
const trainEnd = flag('train-end', '2026-10-18'), innerEnd = flag('inner-end', '2026-10-11')
const cacheDir = '.recalibration-cache'
const bucketIds = ['0-48h', '48-96h', '96-168h']

async function main() {
  if (!(from < innerEnd && innerEnd < trainEnd && trainEnd < to)) throw new Error('Dates must be chronological and disjoint')
  mkdirSync(cacheDir, { recursive: true })
  const samples = Object.fromEntries(metrics.map(m => [m, Object.fromEntries(bucketIds.map(b => [b, [] as TimedSample[]]))]))
  const coverage: Record<string, Record<string, number>> = {}
  for (const location of locations) {
    const regionModels = MODELS.filter(m => m.id !== 'marine_global' && (m.region === 'global' || m.region === (location.country === 'US' || location.country === 'CA' ? 'namerica' : 'europe'))).map(m => m.id)
    const key = createHash('sha256').update(JSON.stringify({ version: 2, from, to, location, metrics, regionModels })).digest('hex').slice(0, 16)
    const path = `${cacheDir}/${key}.json.gz`
    let payload: { forecast: ForecastArchiveRow[]; observations: ObservationRow[] }
    if (existsSync(path)) payload = JSON.parse(gunzipSync(readFileSync(path)).toString())
    else {
      console.log(`[download] ${location.name}: ${from}..${to}, ${regionModels.length} models`)
      const forecast = await fetchPreviousRuns(location, from, to, undefined, { metrics, modelIds: regionModels })
      const observations = await fetchERA5Observations(location, from, to, undefined, metrics)
      if (!forecast.length || !observations.length) throw new Error(`${location.name}: empty payload`)
      payload = { forecast, observations }
      writeFileSync(path, gzipSync(JSON.stringify(payload)))
      // Bound the provider load. Cached repetitions make no network calls.
      await new Promise(r => setTimeout(r, 2500))
    }
    const obs = new Map(payload.observations.map(r => [`${r.metric}|${r.valid_time}`, r.observed_value]))
    const grouped = new Map<string, TimedSample>()
    coverage[location.name] = {}
    for (const row of payload.forecast) {
      // Day 0 is a stitched current run, not an independent past forecast.
      if (row.lead_time_hours === 0 || row.predicted_value === null) continue
      if (!row.valid_time.endsWith('Z') || Date.parse(row.valid_time) - Date.parse(row.init_time) !== row.lead_time_hours * 3600_000) throw new Error('Archive alignment invariant failed')
      const observed = obs.get(`${row.metric}|${row.valid_time}`)
      if (typeof observed !== 'number' || !Number.isFinite(observed)) continue
      const bucket = getLeadTimeBucket(row.lead_time_hours)
      const k = `${row.metric}|${bucket}|${row.valid_time}|${row.lead_time_hours}`
      const entry = grouped.get(k) ?? { observed, byModel: {}, time: row.valid_time, location: location.name }
      entry.byModel[row.model_id] = row.predicted_value
      grouped.set(k, entry)
      coverage[location.name][row.model_id] = (coverage[location.name][row.model_id] ?? 0) + 1
    }
    for (const [key, entry] of grouped) {
      const [metric, bucket] = key.split('|')
      if (Object.keys(entry.byModel).length >= 3) samples[metric][bucket].push(entry)
    }
    console.log(`[aligned] ${location.name}: ${grouped.size} metric/time/lead points, ${Object.keys(coverage[location.name]).length} models with data`)
  }
  const report: Record<string, unknown> = { version: 2, from, to, trainEnd, innerEnd, locations: locations.map(l => l.name), coverage, buckets: {} }
  const weights: Record<string, Record<string, Record<string, number>>> = {}
  const results: Record<string, unknown> = {}
  for (const metric of metrics) {
    weights[metric] = {}
    for (const bucket of bucketIds) {
      const all = samples[metric][bucket]
      const train = all.filter(s => s.time.slice(0, 10) <= trainEnd)
      const test = all.filter(s => s.time.slice(0, 10) > trainEnd)
      if (train.length < 1000 || test.length < 500) throw new Error(`Insufficient samples: ${metric}/${bucket}`)
      const baseline = BASELINE_ENSEMBLE_PRESETS.find(p => p.id === metric)!.weights[bucket]
      const candidate = calibrateBucket(train, innerEnd, baseline)
      const priorStats = ensembleError(test, baseline)
      const candidateStats = ensembleError(test, candidate.weights)
      // Final holdout is a release gate, not a tuning surface.
      const accepted = candidateStats.n === priorStats.n && candidateStats.rmse < priorStats.rmse
        && (metric !== 'precipitation' || (candidateStats.csi ?? 0) >= (priorStats.csi ?? 0))
      weights[metric][bucket] = accepted ? candidate.weights : baseline
      results[`${metric}/${bucket}`] = { train: train.length, test: test.length, power: candidate.power, blend: candidate.blend,
        accepted, baseline: priorStats, candidate: candidateStats }
      console.log(`[holdout] ${metric}/${bucket}: ${priorStats.rmse.toFixed(4)} -> ${candidateStats.rmse.toFixed(4)}, accepted=${accepted}`)
    }
  }
  report.buckets = results
  writeFileSync('docs/recalibration-2026-11-08.json', JSON.stringify(report, null, 2) + '\n')
  writeFileSync(`${cacheDir}/validated-weights.json`, JSON.stringify({ version: 2, from, trainEnd, to, weights }, null, 2) + '\n')
}
main().catch(e => { console.error(e); process.exitCode = 1 })

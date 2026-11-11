import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { BACKTEST_LOCATIONS, BACKTEST_METRIC_TO_PARAM } from '../lib/backtest/config'
import { ensembleError, type JoinedSample } from '../lib/backtest/evalEnsemble'
import { fetchWithTimeout } from '../lib/fetchWithTimeout'
import { ENSEMBLE_PRESETS, getLeadTimeBucket, MODELS } from '../lib/models'
import type { ObservationRow } from '../lib/backtest/db'
import { archiveDir, metrics } from './forecastAuditData'

const sites = ['Barcelona', 'Madrid', 'London', 'Berlin', 'Chicago', 'Los Angeles']
const locations = sites.map(name => BACKTEST_LOCATIONS.find(loc => loc.name === name)!)
const models = MODELS.filter(m => m.region === 'global' && m.maxHours > 168).map(m => m.id)
const runs = ['09', '12', '15', '18', '21', '24'].map(day => `2026-10-${day}T00:00`)
const fields = [...metrics, 'precipitation_probability'].map(metric => BACKTEST_METRIC_TO_PARAM[metric] ?? metric)
type RunResponse = { hourly?: Record<string, (number | null)[]> }

async function fetchRun(run: string, model: string): Promise<RunResponse[]> {
  const path = `${archiveDir}/single-run-v3-${run.replace(':', '')}-${model}.json.gz`
  if (existsSync(path)) return JSON.parse(gunzipSync(readFileSync(path)).toString())
  const params = new URLSearchParams({
    latitude: locations.map(l => l.lat).join(','),
    longitude: locations.map(l => l.lon).join(','),
    hourly: fields.join(','),
    models: model,
    run,
    forecast_days: '15',
    timezone: 'GMT',
    timeformat: 'unixtime',
  })
  const response = await fetchWithTimeout(`https://single-runs-api.open-meteo.com/v1/forecast?${params}`, { timeoutMs: 12000 })
  if (!response.ok) throw new Error(`Single Runs ${response.status}`)
  const result: unknown = await response.json()
  if (!Array.isArray(result) || result.length !== sites.length) throw new Error('Incomplete run response')
  writeFileSync(path, gzipSync(JSON.stringify(result)))
  return result
}

async function main() {
  const obs = new Map<string, number>()
  for (const file of readdirSync(archiveDir).filter(name => /^[a-f0-9]{16}\.json\.gz$/.test(name) || /^audit-v3-.*-2026-11-02-2026-11-05\.json\.gz$/.test(name))) {
    const { observations } = JSON.parse(gunzipSync(readFileSync(`${archiveDir}/${file}`)).toString()) as { observations: ObservationRow[] }
    for (const r of observations) if (r.observed_value !== null) obs.set(`${r.lat}|${r.lon}|${r.metric}|${r.valid_time}`, r.observed_value)
  }
  const samples = new Map<string, { cell: string; sample: JoinedSample }>()
  const availability: Record<string, { amount: number; probability: number }> = {}
  const errors: string[] = []
  for (const run of runs) {
    for (const model of models) {
      let payload: RunResponse[]
      try {
        payload = await fetchRun(run, model)
      } catch (error) {
        const message = `${run}/${model}: ${(error as Error).message}`
        console.warn(message)
        errors.push(message)
        continue
      }
      console.log(`[single run] ${run}/${model}`)
      const count = availability[model] ??= { amount: 0, probability: 0 }
      payload.forEach(({ hourly }, index) => {
        if (!hourly?.time) return
        const { lat, lon } = locations[index]
        for (const [i, time] of hourly.time.entries()) {
          if (time === null) continue
          const valid = new Date(time * 1000).toISOString()
          const lead = (Date.parse(valid) - Date.parse(run + 'Z')) / 3600000
          if (lead <= 168 || lead > 336) continue
          if (Number.isFinite(hourly.precipitation_probability?.[i])) count.probability++
          if (Number.isFinite(hourly.precipitation?.[i])) count.amount++
          for (const metric of metrics) {
            const observed = obs.get(`${lat}|${lon}|${metric}|${valid}`)
            const value = hourly[BACKTEST_METRIC_TO_PARAM[metric]]?.[i]
            if (observed === undefined || typeof value !== 'number' || !Number.isFinite(value)) continue
            const cell = `${metric}/${getLeadTimeBucket(lead)}`
            const key = `${run}|${sites[index]}|${metric}|${valid}`
            const entry = samples.get(key) ?? { cell, sample: { observed, byModel: {} } }
            entry.sample.byModel[model] = value
            samples.set(key, entry)
          }
        }
      })
    }
  }
  const cells: Record<string, unknown> = {}
  const pairedRuns = new Set<string>()
  for (const metric of metrics) {
    for (const lead of ['168-240h', '240-360h']) {
      const cell = `${metric}/${lead}`
      const paired = [...samples.entries()].filter(([, x]) => x.cell === cell &&
        Object.hasOwn(x.sample.byModel, 'ecmwf_ifs') && Object.hasOwn(x.sample.byModel, 'gfs_global')).map(([key, x]) => {
        pairedRuns.add(key.split('|')[0])
        return x.sample
      })
      if (!paired.length) continue
      const prior = ENSEMBLE_PRESETS.find(p => p.id === metric)!.weights[lead]
      const weights = Object.fromEntries(models.map(id => [id, prior[id] ?? 0.01]))
      const equal = Object.fromEntries(models.map(id => [id, 1]))
      cells[cell] = {
        current: ensembleError(paired, weights), equal: ensembleError(paired, equal),
        ifs: ensembleError(paired, { ecmwf_ifs: 1 }), gfs: ensembleError(paired, { gfs_global: 1 }),
      }
    }
  }
  if (!Object.keys(cells).length) throw new Error('No paired IFS/GFS forecasts')
  writeFileSync('docs/forecast-long-range-2026-11-11.json', JSON.stringify({ sites, runs, pairedRuns: [...pairedRuns].sort(), models, availability, errors, cells }, null, 2) + '\n')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

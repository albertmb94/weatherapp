import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import { fetchXemaObservations } from '../lib/backtest/fetchStations'
import { fetchPreviousRuns } from '../lib/backtest/fetchPreviousRuns'
import { BASELINE_ENSEMBLE_PRESETS, ENSEMBLE_PRESETS, getLeadTimeBucket } from '../lib/models'
import { ensembleError, type JoinedSample } from '../lib/backtest/evalEnsemble'
import type { ForecastArchiveRow, StationObservationRow } from '../lib/backtest/db'

const dir = '.recalibration-cache', from = '2026-10-11', to = '2026-11-07'
const targetIds = ['WU', 'X4', 'WT'] // Badalona Museu, Barcelona Raval, Malgrat
const trainEnd = '2026-10-24'
async function main() {
  mkdirSync(dir, { recursive: true })
  let obs: StationObservationRow[] = JSON.parse(gunzipSync(readFileSync(`${dir}/xema-utc-hour-end-2026-10-19-2026-11-01.json.gz`)).toString())
  for (const [start, end] of [['2026-10-11', '2026-10-18'], ['2026-11-02', '2026-11-07']]) {
    const path = `${dir}/xema-rain-utc-${start}-${end}.json.gz`
    let extra: StationObservationRow[]
    if (existsSync(path)) extra = JSON.parse(gunzipSync(readFileSync(path)).toString())
    else {
      if (!process.env.METEOCAT_API_KEY) throw new Error('Missing XEMA key')
      extra = await fetchXemaObservations(start, end, process.env.METEOCAT_API_KEY, ['precipitation'], undefined, console.log)
      if (!extra.length) throw new Error('No validated rain observations')
      writeFileSync(path, gzipSync(JSON.stringify(extra)))
    }
    obs = obs.concat(extra)
  }
  const cities: Record<string, unknown> = {}
  const corrections: unknown[] = []
  for (const id of targetIds) {
    const stationObs = obs.filter(o => o.station_id === id && o.metric === 'precipitation')
    const st = stationObs[0]
    if (!st) throw new Error(`Station missing: ${id}`)
    const path = `${dir}/coast-rain-v2-${id}-${from}-${to}.json.gz`
    let rows: ForecastArchiveRow[]
    if (existsSync(path)) rows = JSON.parse(gunzipSync(readFileSync(path)).toString())
    else {
      rows = await fetchPreviousRuns({ name: id, lat: st.lat, lon: st.lon, terrain: 'coastal', country: 'ES' }, from, to, undefined, { metrics: ['precipitation'] })
      writeFileSync(path, gzipSync(JSON.stringify(rows)))
    }
    const observed = new Map(stationObs.map(o => [o.valid_time, o.observed_value]))
    const groups = new Map<string, JoinedSample & { time: string; lead: number }>()
    for (const r of rows) {
      const truth = observed.get(r.valid_time)
      if (truth === undefined || truth === null || r.predicted_value === null) continue
      const key = `${r.valid_time}|${r.lead_time_hours}`
      const s = groups.get(key) ?? { observed: truth, byModel: {}, time: r.valid_time, lead: r.lead_time_hours }
      s.byModel[r.model_id] = r.predicted_value
      groups.set(key, s)
    }
    const leads: Record<string, unknown> = {}
    for (const lead of [0, 24, 48, 72, 96, 120, 144, 168]) {
      const samples = [...groups.values()].filter(s => s.lead === lead && Object.keys(s.byModel).length >= 3)
      const bucket = getLeadTimeBucket(lead)
      const weights = ENSEMBLE_PRESETS.find(p => p.id === 'precipitation')!.weights[bucket]
      const baseline = BASELINE_ENSEMBLE_PRESETS.find(p => p.id === 'precipitation')!.weights[bucket]
      let observedMm = 0, forecastMm = 0
      const days: Record<string, { observedMm: number; forecastMm: number; hours: number }> = {}
      for (const s of samples) {
        let n = 0, d = 0
        for (const [m, v] of Object.entries(s.byModel)) { const w = weights[m] ?? 0.01; n += v * w; d += w }
        const prediction = n / d
        observedMm += s.observed; forecastMm += prediction
        const day = s.time.slice(0, 10)
        const cell = days[day] ?? { observedMm: 0, forecastMm: 0, hours: 0 }
        cell.observedMm += s.observed; cell.forecastMm += prediction; cell.hours++
        days[day] = cell
      }
      leads[lead] = { observedMm, forecastMm, ratio: observedMm ? forecastMm / observedMm : null,
        baseline: ensembleError(samples, baseline), release: ensembleError(samples, weights), days }
    }
    cities[id] = { name: st.station_name, lat: st.lat, lon: st.lon, leads }
    const factors: Record<string, number> = {}
    const calibration: Record<string, unknown> = {}
    for (const bucket of ['0-48h', '48-96h', '96-168h']) {
      const weights = ENSEMBLE_PRESETS.find(p => p.id === 'precipitation')!.weights[bucket]
      const points = [...groups.values()].filter(s => s.lead >= 24 && getLeadTimeBucket(s.lead) === bucket && Object.keys(s.byModel).length >= 3)
      const fit = points.filter(s => s.time.slice(0, 10) <= trainEnd)
      const test = points.filter(s => s.time.slice(0, 10) > trainEnd)
      let xy = 0, xx = 0
      for (const s of fit) {
        let num = 0, den = 0
        for (const [m, v] of Object.entries(s.byModel)) { const w = weights[m] ?? 0.01; num += v * w; den += w }
        const forecast = num / den
        xy += forecast * s.observed; xx += forecast * forecast
      }
      // A bounded nonnegative slope, fitted ONLY on earlier dates.
      const factor = Math.max(0.25, Math.min(1.25, xx ? xy / xx : 1))
      const raw = ensembleError(test, weights)
      const adjusted = ensembleError(test.map(s => ({ ...s, byModel: Object.fromEntries(Object.entries(s.byModel).map(([m, v]) => [m, v * factor])) })), weights)
      const wetFit = fit.filter(s => s.observed >= 0.1).length
      const wetTest = test.filter(s => s.observed >= 0.1).length
      const accepted = wetFit >= 10 && wetTest >= 5 && adjusted.rmse < raw.rmse && adjusted.mae < raw.mae
        && (adjusted.csi ?? 0) >= (raw.csi ?? 0) && adjusted.n === raw.n
      factors[bucket] = accepted ? factor : 1
      calibration[bucket] = { factor, accepted, wetFit, wetTest, trainN: fit.length, testN: test.length, raw, adjusted }
      console.log(`[local holdout] ${id}/${bucket}: factor=${factor.toFixed(3)}, RMSE ${raw.rmse.toFixed(3)} -> ${adjusted.rmse.toFixed(3)}, CSI ${raw.csi} -> ${adjusted.csi}, accepted=${accepted}`)
    }
    corrections.push({ id, name: st.station_name, lat: st.lat, lon: st.lon, radiusKm: 5, factors })
    ;(cities[id] as Record<string, unknown>).calibration = calibration
    console.log(`[coastal rain] ${st.station_name}: ${groups.size} aligned points`)
  }
  writeFileSync('docs/coastal-rain-2026-11-08.json', JSON.stringify({ from, to,
    note: 'UTC hours ending at timestamp. Offset 0 is the stitched historical current run, not an issued short-lead archive.', cities }, null, 2) + '\n')
  writeFileSync('lib/ensemble/coastal-rain.generated.json', JSON.stringify({ version: 1, from, trainEnd, to,
    minLeadHours: 24, maxLeadHours: 168, corrections }, null, 2) + '\n')
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })

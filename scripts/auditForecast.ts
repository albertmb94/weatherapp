import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { buildForecastRequest, DEFAULT_FORECAST_DAYS } from '../lib/openMeteo'
import { ENSEMBLE_PRESETS, getLeadTimeBucket, METRICS, MODELS } from '../lib/models'
import { BACKTEST_LOCATIONS } from '../lib/backtest/config'
import { classifyTerrainAtElevation } from '../lib/backtest/classifyTerrain'
import { deriveProfileFromTerrain, type UsageProfile } from '../lib/profiles'
import { ensembleError } from '../lib/backtest/evalEnsemble'
import { fitJointWeights, noRegression, pairedRmseInterval, predictMembers, type Weights } from '../lib/backtest/jointCalibration'
import { normalizeWeights, type TimedSample } from '../lib/backtest/temporalCalibration'
import type { ForecastArchiveRow, ObservationRow, StationObservationRow } from '../lib/backtest/db'
import { archiveDir, archivePath, holdoutNames, metrics, recentWindow, spatialWindow, trainingNames } from './forecastAuditData'

type Case = TimedSample & { lead: number; reference: string; profile: UsageProfile | null }
type Archive = { forecast: ForecastArchiveRow[]; observations: ObservationRow[] }
const buckets = ['0-48h', '48-96h', '96-168h']
const fitEnd = '2026-10-01'
const refitEnd = '2026-10-11'
const validationStart = '2026-10-14'
const validationEnd = '2026-10-18'
const evaluationStart = '2026-10-24'
const observationDelayDays = 5

function afterEmbargo(sample: Case, cutoff: string): boolean {
  // The cutoff is inclusive. A day is eligible after it has closed and
  // the reference observations have had time to become available.
  return Date.parse(sample.reference) >= Date.parse(cutoff) + (observationDelayDays + 1) * 86400000
}

function readGzip<T>(path: string): T {
  return JSON.parse(gunzipSync(readFileSync(path)).toString())
}

function join(name: string, forecast: ForecastArchiveRow[], observations: ObservationRow[], profile: UsageProfile | null) {
  const cells: Record<string, Case[]> = {}
  if (!forecast.length) return cells
  const { lat, lon } = forecast[0]
  const liveModels = new Set(buildForecastRequest(lat, lon, MODELS, METRICS, DEFAULT_FORECAST_DAYS).capped.map(model => model.id))
  const observed = new Map(observations.map(row => [`${row.metric}|${row.valid_time}`, row.observed_value]))
  const grouped = new Map<string, { cell: string; sample: Case }>()
  for (const row of forecast) {
    if (!buckets.includes(getLeadTimeBucket(row.lead_time_hours)) || row.lead_time_hours < 24 ||
        row.predicted_value === null || !Number.isFinite(row.predicted_value) || !liveModels.has(row.model_id)) continue
    if (!row.valid_time.endsWith('Z') || Date.parse(row.valid_time) - Date.parse(row.init_time) !== row.lead_time_hours * 3600000) {
      throw new Error(`Invalid forecast clock at ${name}`)
    }
    const truth = observed.get(`${row.metric}|${row.valid_time}`)
    if (typeof truth !== 'number' || !Number.isFinite(truth)) continue
    const cell = `${row.metric}/${getLeadTimeBucket(row.lead_time_hours)}`
    const key = `${cell}|${row.valid_time}|${row.lead_time_hours}`
    let entry = grouped.get(key)
    if (!entry) {
      entry = { cell, sample: { observed: truth, byModel: {}, time: row.valid_time, reference: row.init_time, lead: row.lead_time_hours, location: name, profile } }
      grouped.set(key, entry)
    }
    entry.sample.byModel[row.model_id] = row.predicted_value
  }
  for (const { cell, sample } of grouped.values()) (cells[cell] ??= []).push(sample)
  return cells
}

function load() {
  const elevationPath = `${archiveDir}/audit-elevations.json`
  const elevations: Record<string, number> = existsSync(elevationPath) ? JSON.parse(readFileSync(elevationPath, 'utf8')) : {}
  const profiles = Object.fromEntries(BACKTEST_LOCATIONS.filter(l => Number.isFinite(elevations[l.name]))
    .map(l => [l.name, deriveProfileFromTerrain(classifyTerrainAtElevation(l.lat, l.lon, elevations[l.name]))]))
  const prior: Record<string, Case[]> = {}
  const novel: Record<string, Case[]> = {}
  const recent: Record<string, Case[]> = {}
  const stations: Record<string, Case[]> = {}
  const coverage = { training: [] as string[], spatial: [] as string[], recent: [] as string[], stations: [] as string[] }
  const merge = (dest: Record<string, Case[]>, source: Record<string, Case[]>) => {
    for (const [key, rows] of Object.entries(source)) (dest[key] ??= []).push(...rows)
  }
  for (const file of readdirSync(archiveDir).filter(name => /^[a-f0-9]{16}\.json\.gz$/.test(name))) {
    const { forecast, observations } = readGzip<Archive>(`${archiveDir}/${file}`)
    const row = forecast[0]
    const location = BACKTEST_LOCATIONS.find(loc => loc.lat === row?.lat && loc.lon === row?.lon)
    if (!location || !trainingNames.includes(location.name)) continue
    coverage.training.push(location.name)
    merge(prior, join(location.name, forecast, observations, profiles[location.name] ?? null))
  }
  for (const { names, window, destination, used } of [
    { names: holdoutNames, window: spatialWindow, destination: novel, used: coverage.spatial },
    { names: trainingNames, window: recentWindow, destination: recent, used: coverage.recent },
  ]) {
    for (const name of names) {
      const path = archivePath(name, window.from, window.to)
      if (!existsSync(path)) continue
      const { forecast, observations } = readGzip<Archive>(path)
      used.push(name)
      merge(destination, join(name, forecast, observations, profiles[name] ?? null))
    }
  }
  const stationTruth = readGzip<StationObservationRow[]>(`${archiveDir}/xema-utc-hour-end-2026-10-19-2026-11-01.json.gz`)
  for (const file of readdirSync(archiveDir).filter(name => /^xema-forecast-v2-.+-2026-10-19-2026-11-01\.json\.gz$/.test(name))) {
    const id = file.split('-')[3]
    const forecast = readGzip<ForecastArchiveRow[]>(`${archiveDir}/${file}`)
    const observations = stationTruth.filter(row => row.station_id === id)
    merge(stations, join(id, forecast, observations, null))
    coverage.stations.push(id)
  }
  return { prior, novel, recent, stations, coverage, profiles }
}

const { prior, novel, recent, stations, coverage, profiles } = load()
const results: Record<string, unknown> = {}
const profilesTested: Record<string, unknown> = {}
const proposed: Record<string, Record<string, Weights>> = {}
for (const metric of metrics) {
  proposed[metric] = {}
  for (const bucket of buckets) {
    const cell = `${metric}/${bucket}`
    const samples = prior[cell]
    const rawWeights = ENSEMBLE_PRESETS.find(p => p.id === metric)!.weights[bucket]
    const weights = normalizeWeights(Object.fromEntries(MODELS.filter(m => m.id !== 'marine_global')
      .map(model => [model.id, rawWeights[model.id] ?? 0.01])))
    const equal = Object.fromEntries(Object.keys(weights).map(id => [id, 1]))
    const fit = samples.filter(s => s.time.slice(0, 10) <= fitEnd)
    const validation = samples.filter(s => s.time.slice(0, 10) >= validationStart && s.time.slice(0, 10) <= validationEnd && afterEmbargo(s, fitEnd))
    const refit = samples.filter(s => s.time.slice(0, 10) <= refitEnd)
    const rain = metric === 'precipitation'
    let winner: number | null = null
    const baseline = ensembleError(validation, weights)
    let best = baseline.rmse
    for (const penalty of [0.015, 0.06, 0.2]) {
      const trial = ensembleError(validation, fitJointWeights(fit, weights, penalty))
      if (noRegression(baseline, trial, rain, 0.01) && trial.rmse < best) {
        winner = penalty
        best = trial.rmse
      }
    }
    const candidate = winner === null ? weights : fitJointWeights(refit, weights, winner)
    // Independent diagnostic for amount bias: fit only on the training
    // window and score detection again after changing the amount scale.
    const rainSlope = rain ? (() => {
      let covariance = 0, square = 0
      for (const row of refit) {
        const prediction = predictMembers(row, weights)
        if (prediction === null) continue
        covariance += prediction * row.observed
        square += prediction ** 2
      }
      return square > 0 ? Math.max(0.5, Math.min(1.5, covariance / square)) : 1
    })() : null
    const single = Object.keys(weights).map(id => ({
      id,
      stats: ensembleError(validation, { [id]: 1 }),
    })).filter(x => x.stats.n >= validation.length * 0.95)
      .sort((a, b) => a.stats.rmse - b.stats.rmse)[0]?.id
    const totals = (rows: Case[], modelWeights: Weights) => {
      let forecast = 0, observed = 0, wet = 0
      for (const row of rows) {
        const estimate = predictMembers(row, modelWeights)
        if (estimate === null) continue
        forecast += estimate
        observed += row.observed
        if (row.observed >= 0.1) wet++
      }
      return { forecast, observed, wet }
    }
    const score = (rows: Case[]) => ({
      current: ensembleError(rows, weights),
      equal: ensembleError(rows, equal),
      candidate: ensembleError(rows, candidate),
      rmseDelta95: pairedRmseInterval(rows, weights, candidate),
      rainTotals: rain ? { current: totals(rows, weights), candidate: totals(rows, candidate) } : undefined,
      scaledRain: rainSlope === null ? undefined : ensembleError(rows.flatMap(row => {
        const amount = predictMembers(row, weights)
        return amount === null ? [] : [{ observed: row.observed, byModel: { scaled: amount * rainSlope } }]
      }), { scaled: 1 }),
      singleModel: single ? (() => {
        const comparable = rows.filter(s => Object.hasOwn(s.byModel, single))
        return { id: single, raw: ensembleError(comparable, { [single]: 1 }),
          current: ensembleError(comparable, weights), candidate: ensembleError(comparable, candidate) }
      })() : undefined,
      byLead: Object.fromEntries([...new Set(rows.map(s => s.lead))].sort((a, b) => a - b).map(lead => {
        const subset = rows.filter(s => s.lead === lead)
        return [lead, { current: ensembleError(subset, weights), candidate: ensembleError(subset, candidate) }]
      })),
    })
    const eligible = (s: Case) => s.time.slice(0, 10) >= evaluationStart && afterEmbargo(s, refitEnd)
    const temporal = score(samples.filter(eligible))
    const spatial = score((novel[cell] ?? []).filter(eligible))
    const fresh = score((recent[cell] ?? []).filter(eligible))
    const station = score((stations[cell] ?? []).filter(eligible))
    const accepted = winner !== null && coverage.spatial.length >= 6 && coverage.stations.length >= 8 && coverage.recent.length >= 12 &&
      spatial.rmseDelta95 !== null && spatial.rmseDelta95.high < 0 &&
      spatial.candidate.rmse < spatial.equal.rmse &&
      noRegression(temporal.current, temporal.candidate, rain, 0.005) &&
      noRegression(spatial.current, spatial.candidate, rain) &&
      noRegression(station.current, station.candidate, rain, 0.01) &&
      noRegression(fresh.current, fresh.candidate, rain, 0.02)
    if (accepted) proposed[metric][bucket] = candidate
    results[cell] = { penalty: winner, rainSlope, fit: fit.length, validation: validation.length, refit: refit.length,
      internal: { current: baseline, equal: ensembleError(validation, equal) }, accepted, temporal, spatial, fresh, station }
    console.log(`[${cell}] prior / candidate RMSE: ${temporal.current.rmse.toFixed(3)} / ${temporal.candidate.rmse.toFixed(3)} (temporal); ${spatial.current.rmse.toFixed(3)} / ${spatial.candidate.rmse.toFixed(3)} (spatial); ${station.current.rmse.toFixed(3)} / ${station.candidate.rmse.toFixed(3)} (XEMA); accepted=${accepted}`)

    for (const profile of ['coastal', 'urban', 'mountain', 'plain'] as const) {
      const training = refit.filter(s => s.profile === profile)
      const test = (novel[cell] ?? []).filter(s => s.profile === profile && eligible(s))
      const nFit = new Set(training.map(s => s.location)).size
      const nTest = new Set(test.map(s => s.location)).size
      const key = `${cell}/${profile}`
      if (nFit < 3 || nTest < 2) {
        profilesTested[key] = { nFit, nTest, reason: 'Insufficient distinct locations' }
        continue
      }
      // Fixed strong shrinkage for small terrain subsets. Compare against
      // the release (including an accepted global change), not against equal weights.
      const global = accepted ? candidate : weights
      const local = fitJointWeights(training, global, 0.2)
      profilesTested[key] = { nFit, nTest, global: ensembleError(test, global), local: ensembleError(test, local),
        rmseDelta95: pairedRmseInterval(test, global, local) }
    }
  }
}
const report = { fitEnd, refitEnd, validationStart, validationEnd, evaluationStart, observationDelayDays, coverage, profiles, results, profilesTested }
writeFileSync(`${archiveDir}/audit-v3-candidates.json`, JSON.stringify(proposed, null, 2) + '\n')
writeFileSync('docs/forecast-audit-2026-11-11.json', JSON.stringify(report, null, 2) + '\n')

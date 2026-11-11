import { writeFileSync } from 'node:fs'
import type { ForecastArchiveRow, StationObservationRow } from '../lib/backtest/db'
import { ensemblePresetWeights } from '../lib/ensemble/central'
import { rainFactor } from '../lib/ensemble/rainCalibration'
import { getLeadTimeBucket, MODELS, METRICS } from '../lib/models'
import { buildForecastRequest, DEFAULT_FORECAST_DAYS } from '../lib/openMeteo'
import { fitThrough, readRainArchive, stations, trainingForecastFile, trainingObservationFile } from './rainTargetData'

const wetThreshold = 0.1
const selectionStart = '2026-10-17'
const selectionThrough = '2026-10-24'
const lateStart = '2026-11-07'
const currentAsOf = Date.parse('2026-11-11T00:00Z')
const objective = { pod: 0.8, accumulatedRelativeError: 0.2, far: 0.6, minWetHours: 20, minDays: 10 }
const spatialStations = ['C6', 'CW', 'DJ', 'MS', 'UJ', 'V8', 'VY', 'WM', 'XJ', 'XZ', 'YL']

type Hour = {
  station: string
  time: string
  reference: string
  lead: number
  observed: number
  mean: number
  vote: number
  max: number
  production: number
  recentMean?: number
}
type Estimate = (hour: Hour) => number
type Sample = { station: StationObservationRow; hours: Hour[] }

function assemble(ids = stations, external = false): Sample[] {
  const observations = [
    trainingObservationFile,
    'xema-rain-utc-2026-10-11-2026-10-18.json.gz',
    'xema-utc-hour-end-2026-10-19-2026-11-01.json.gz',
    'xema-rain-utc-2026-11-02-2026-11-07.json.gz',
    'xema-rain-audit-2026-11-07-2026-11-10.json.gz',
  ].flatMap(file => readRainArchive<StationObservationRow[]>(file)).filter(row => row.metric === 'precipitation')
  return ids.map(id => {
    const station = observations.find(row => row.station_id === id)
    if (!station) throw new Error(`Missing station: ${id}`)
    const { lat, lon } = station
    const observed = new Map(observations.filter(row => row.station_id === id).map(row => [row.valid_time, row.observed_value]))
    const forecastFiles = external
      ? [`xema-forecast-v2-${id}-2026-10-19-2026-11-01.json.gz`]
      : [trainingForecastFile(id), `coast-rain-v2-${id}-2026-10-11-2026-11-07.json.gz`,
        `coastal-audit-${id}-2026-11-07-2026-11-10.json.gz`]
    const forecast = forecastFiles.flatMap(file => readRainArchive<ForecastArchiveRow[]>(file))
    const { capped } = buildForecastRequest(lat, lon, MODELS, METRICS, DEFAULT_FORECAST_DAYS)
    const allowed = new Set(capped.map(model => model.id))
    const groups = new Map<string, { time: string; reference: string; lead: number; observed: number; members: Map<string, number> }>()
    for (const row of forecast) {
      const truth = observed.get(row.valid_time)
      if (row.metric !== 'precipitation' || row.lead_time_hours < 24 || !allowed.has(row.model_id) ||
          typeof row.predicted_value !== 'number' || !Number.isFinite(row.predicted_value) || typeof truth !== 'number') continue
      if (Date.parse(row.valid_time) - Date.parse(row.init_time) !== row.lead_time_hours * 3600000) throw new Error('Time alignment failed')
      const key = `${row.valid_time}|${row.lead_time_hours}`
      const group = groups.get(key) ?? { time: row.valid_time, reference: row.init_time, lead: row.lead_time_hours, observed: truth, members: new Map() }
      group.members.set(row.model_id, row.predicted_value)
      groups.set(key, group)
    }
    const hours = [...groups.values()].map(({ members, ...group }) => {
      const weights = ensemblePresetWeights('precipitation', getLeadTimeBucket(group.lead))
      let total = 0, amount = 0, wet = 0, max = 0
      for (const [id, value] of members) {
        const weight = weights[id] ?? 0.01
        total += weight
        amount += weight * value
        if (value >= wetThreshold) wet += weight
        max = Math.max(max, value)
      }
      const mean = amount / total
      return { ...group, station: id, mean, vote: wet / total, max, production: mean * rainFactor(lat, lon, group.lead, currentAsOf) }
    })
    const byOffsetAndHour = new Map(hours.map(hour => [`${hour.lead}|${hour.time}`, hour.mean]))
    const withHistory = hours.map(hour => {
      const previous = [1, 2].map(offset => new Date(Date.parse(hour.time) - offset * 3600000).toISOString())
      const recentMean = Math.max(0, ...previous.map(time => byOffsetAndHour.get(`${hour.lead}|${time}`) ?? 0))
      return { ...hour, recentMean }
    })
    return { station, hours: withHistory }
  })
}

function metrics(hours: Hour[], amount: Estimate, detect: (hour: Hour) => boolean) {
  let hits = 0, misses = 0, falseAlarms = 0, sq = 0
  const days = new Map<string, { observed: number; expected: number; n: number }>()
  for (const h of hours) {
    const predictedWet = detect(h)
    const observedWet = h.observed >= wetThreshold
    if (predictedWet && observedWet) hits++
    else if (observedWet) misses++
    else if (predictedWet) falseAlarms++
    const prediction = amount(h)
    sq += (prediction - h.observed) ** 2
    // Use the day of the start of the preceding hour, so 00 UTC
    // contributes to the preceding UTC day's accumulation.
    const day = new Date(Date.parse(h.time) - 3600000).toISOString().slice(0, 10)
    const key = `${h.station}|${h.lead}|${day}`
    const cell = days.get(key) ?? { observed: 0, expected: 0, n: 0 }
    cell.observed += h.observed
    cell.expected += prediction
    cell.n++
    days.set(key, cell)
  }
  const complete = [...days.values()].filter(day => day.n === 24)
  const observed = complete.reduce((sum, day) => sum + day.observed, 0)
  const expected = complete.reduce((sum, day) => sum + day.expected, 0)
  const dailyAbsError = complete.reduce((sum, day) => sum + Math.abs(day.expected - day.observed), 0)
  return {
    hours: hours.length, days: complete.length, wetHours: hits + misses, hits, misses, falseAlarms,
    pod: hits + misses ? hits / (hits + misses) : null,
    far: hits + falseAlarms ? falseAlarms / (hits + falseAlarms) : null,
    csi: hits + misses + falseAlarms ? hits / (hits + misses + falseAlarms) : null,
    rmse: hours.length ? Math.sqrt(sq / hours.length) : null,
    observedMm: observed, forecastMm: expected,
    accumulatedRelativeError: observed > 0 ? Math.abs(expected - observed) / observed : null,
    dailyWape: observed > 0 ? dailyAbsError / observed : null,
  }
}

const feature = (hour: Hour, persistence: boolean) => [
  1, Math.log1p(hour.mean / wetThreshold), hour.vote, Math.log1p(hour.max / wetThreshold),
  ...(persistence ? [Math.log1p((hour.recentMean ?? 0) / wetThreshold)] : []),
]
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))

function fitRainProbability(hours: Hour[], persistence = false): Estimate {
  const rows = hours.map(hour => ({ features: feature(hour, persistence), wet: Number(hour.observed >= wetThreshold) }))
  const rate = (rows.reduce((sum, row) => sum + row.wet, 0) + 1) / (rows.length + 2)
  const beta = rows[0].features.map((_, index) => index === 0 ? Math.log(rate / (1 - rate)) : 0)
  for (let step = 0; step < 350; step++) {
    const gradient = beta.map(() => 0)
    for (const row of rows) {
      const linear = row.features.reduce((sum, x, index) => sum + x * beta[index], 0)
      const residual = sigmoid(linear) - row.wet
      row.features.forEach((x, index) => { gradient[index] += x * residual })
    }
    beta.forEach((value, index) => {
      const next = value - 0.6 * (gradient[index] / rows.length + (index === 0 ? 0 : 0.01 * value))
      beta[index] = index === 0 ? next : Math.max(0, next)
    })
  }
  return hour => sigmoid(feature(hour, persistence).reduce((sum, x, index) => sum + x * beta[index], 0))
}

function scaleOnTraining(hours: Hour[], estimate: Estimate): Estimate {
  const expected = hours.reduce((sum, hour) => sum + estimate(hour), 0)
  const observed = hours.reduce((sum, hour) => sum + hour.observed, 0)
  const factor = Math.max(0.2, Math.min(2.5, expected > 0 ? observed / expected : 1))
  return hour => estimate(hour) * factor
}

function train(fit: Hour[], validation: Hour[]) {
  if (fit.length === 0 || validation.length === 0) throw new Error('Empty fitting or selection window')
  const probability = fitRainProbability(fit)
  const persistence = fitRainProbability(fit, true)
  const signals = { mean: (h: Hour) => h.mean, vote: (h: Hour) => h.vote, probability, persistence }
  const pooled = scaleOnTraining(fit, h => h.mean)
  const local = Object.fromEntries(stations.map(id => [id, scaleOnTraining(fit.filter(h => h.station === id), h => h.mean)]))
  const amounts = {
    production: (h: Hour) => h.production,
    rescaled: pooled,
    localRescaled: (h: Hour) => (pooled(h) + local[h.station](h)) / 2,
    hurdle: scaleOnTraining(fit, h => probability(h) * (h.mean + wetThreshold)),
  }
  const amount = (Object.keys(amounts) as (keyof typeof amounts)[]).map(name => ({
    name, score: metrics(validation, amounts[name], () => false),
  })).sort((a, b) => (a.score.dailyWape ?? Infinity) - (b.score.dailyWape ?? Infinity))[0]
  const trials = (Object.keys(signals) as (keyof typeof signals)[]).flatMap(name =>
    [0.005, 0.01, 0.02, 0.03, 0.05, 0.07, 0.1, 0.13, 0.16, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6].map(threshold => {
      const detect = (hour: Hour) => signals[name](hour) >= threshold
      return { name, threshold, detect, score: metrics(validation, amounts[amount.name], detect) }
    }))
  const feasible = trials.filter(({ score }) => (score.pod ?? 0) >= objective.pod && (score.far ?? 1) <= objective.far)
  const ranked = [...(feasible.length ? feasible : trials)].sort((a, b) => (b.score.csi ?? 0) - (a.score.csi ?? 0))
  return { amount, estimate: amounts[amount.name], chosen: ranked[0], trials }
}

function main() {
  const source = assemble()
  const rows = source.flatMap(s => s.hours)
  const results: Record<string, unknown> = {}
  for (const lead of [24, 48, 72, 96, 120, 144, 168]) {
    const all = rows.filter(h => h.lead === lead)
    const fit = all.filter(h => h.time.slice(0, 10) <= fitThrough)
    const validation = all.filter(h => h.time.slice(0, 10) >= selectionStart && h.time.slice(0, 10) <= selectionThrough &&
      h.reference.slice(0, 10) > fitThrough)
    const test = all.filter(h => h.reference.slice(0, 10) > selectionThrough && h.time.slice(0, 10) < lateStart)
    const late = all.filter(h => h.time.slice(0, 10) >= lateStart)
    const candidate = train(fit, validation)
    const compare = (hours: Hour[]) => {
      const baseline = metrics(hours, h => h.production, h => h.production >= wetThreshold)
      const proposed = metrics(hours, candidate.estimate, candidate.chosen.detect)
      const ready = proposed.wetHours >= objective.minWetHours && proposed.days >= objective.minDays &&
        (proposed.pod ?? 0) >= objective.pod && (proposed.far ?? 1) <= objective.far &&
        (proposed.accumulatedRelativeError ?? Infinity) <= objective.accumulatedRelativeError &&
        (proposed.csi ?? 0) >= (baseline.csi ?? 0) && (proposed.dailyWape ?? Infinity) <= (baseline.dailyWape ?? Infinity)
      return { baseline, proposed, ready }
    }
    const pooled = compare(test)
    const byStation = Object.fromEntries(stations.map(id => [id, compare(test.filter(h => h.station === id))]))
    const accepted = pooled.ready && Object.values(byStation).every(cell => cell.ready)
    const sensitivity = candidate.trials.map(trial => {
      const score = metrics(test, candidate.estimate, trial.detect)
      return { signal: trial.name, threshold: trial.threshold, pod: score.pod, far: score.far }
    }).filter(trial => (trial.pod ?? 0) >= objective.pod && trial.far !== null)
      .sort((a, b) => (a.far ?? 1) - (b.far ?? 1))[0] ?? null
    results[lead] = {
      fitting: fit.length, validation: validation.length, validationWet: validation.filter(h => h.observed >= wetThreshold).length,
      choice: { amount: candidate.amount.name, signal: candidate.chosen.name, threshold: candidate.chosen.threshold },
      internal: candidate.chosen.score,
      validationThresholds: candidate.trials.map(({ name, threshold, score }) => ({
        name, threshold, pod: score.pod, far: score.far, csi: score.csi,
      })),
      // Retrospective sensitivity only. Never choose a threshold here.
      bestObservedFarAtTarget: sensitivity, pooled, byStation, recent: compare(late), accepted,
    }
    console.log(lead, 'wet', pooled.proposed.wetHours, 'POD', pooled.baseline.pod?.toFixed(3), '->', pooled.proposed.pod?.toFixed(3),
      'FAR', pooled.proposed.far?.toFixed(3), 'amount error', pooled.proposed.accumulatedRelativeError?.toFixed(3), 'accepted', accepted)
  }
  const replayWindows = [
    ['2026-09-23', '2026-10-02', '2026-10-11'],
    ['2026-10-02', '2026-10-11', '2026-10-20'],
    ['2026-10-11', '2026-10-20', '2026-10-29'],
  ]
  const rollingReplay = Object.fromEntries([24, 48].map(lead => {
    const eligible = rows.filter(h => h.lead === lead)
    return [lead, replayWindows.map(([fitEnd, selectEnd, testEnd]) => {
      const fitting = eligible.filter(h => h.time.slice(0, 10) <= fitEnd)
      const validation = eligible.filter(h => h.reference.slice(0, 10) > fitEnd && h.time.slice(0, 10) <= selectEnd)
      const test = eligible.filter(h => h.reference.slice(0, 10) > selectEnd && h.time.slice(0, 10) <= testEnd)
      const candidate = train(fitting, validation)
      return { fitEnd, selectEnd, testEnd, choice: candidate.chosen.name, threshold: candidate.chosen.threshold,
        amount: candidate.amount.name, baseline: metrics(test, h => h.production, h => h.production >= wetThreshold),
        proposed: metrics(test, candidate.estimate, candidate.chosen.detect) }
    })]
  }))
  // The 0.30 mm threshold was found retrospectively in the three
  // target stations. Check transport to untouched stations, without
  // using any of their observations to choose a threshold.
  const external = assemble(spatialStations, true).flatMap(s => s.hours).filter(h => h.lead === 24)
  const spatialCheck = {
    stations: spatialStations,
    from: '2026-10-19', to: '2026-11-01',
    baseline: metrics(external, h => h.production, h => h.production >= wetThreshold),
    exploratory: metrics(external, h => h.production, h => h.mean >= 0.3),
  }
  writeFileSync('docs/rain-targets-2026-11-11.json', JSON.stringify({
    objective, wetThreshold, fitThrough, selectionStart, selectionThrough, lateStart,
    stations: source.map(({ station }) => ({ id: station.station_id, name: station.station_name })),
    results, rollingReplay, spatialCheck,
  }, null, 2) + '\n')
}
main()

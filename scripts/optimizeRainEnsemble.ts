import { writeFileSync } from 'node:fs'
import type { ForecastArchiveRow, StationObservationRow } from '../lib/backtest/db'
import { ensemblePresetWeights } from '../lib/ensemble/central'
import { precipitationDayKey } from '../lib/ensemble/precipitationDay'
import { rainFactor } from '../lib/ensemble/rainCalibration'
import { getLeadTimeBucket, MODELS, METRICS } from '../lib/models'
import { buildForecastRequest, DEFAULT_FORECAST_DAYS } from '../lib/openMeteo'
import { ensembleError, type JoinedSample } from '../lib/backtest/evalEnsemble'
import { fitJointWeights, predictMembers, type Weights } from '../lib/backtest/jointCalibration'
import type { TimedSample } from '../lib/backtest/temporalCalibration'
import { normalizeWeights } from '../lib/backtest/temporalCalibration'
import { readRainArchive } from './rainTargetData'
import { fitStations, spatialStations, forecastFile, observationFile, offsets } from './ensembleRainData'

type RainSample = TimedSample & { reference: string; lead: number; factor: number; day: string }
type Estimate = (row: RainSample) => number
type Aggregation = 'mean' | 'winsorized' | 'upperBlend'
type Config = { weights: Weights; blend: string; exponent: number; scale: number; preserveLocal: boolean; aggregation: Aggregation }
const fitThrough = '2026-09-27'
const validationFrom = '2026-10-05'
const validationThrough = '2026-10-18'
const archiveDate = Date.parse('2026-11-11T00:00Z')
const wet = 0.1

function loadRain() {
  const observations = [observationFile, 'xema-rain-utc-2026-10-11-2026-10-18.json.gz',
    'xema-utc-hour-end-2026-10-19-2026-11-01.json.gz', 'xema-rain-utc-2026-11-02-2026-11-07.json.gz']
    .flatMap(file => readRainArchive<StationObservationRow[]>(file)).filter(row => row.metric === 'precipitation')
  return [...fitStations, ...spatialStations].flatMap(id => {
    const truth = observations.filter(row => row.station_id === id)
    const { lat, lon } = truth[0]
    const observed = new Map(truth.map(row => [row.valid_time, row.observed_value]))
    const forecast = [
      ...(fitStations.includes(id) ? [forecastFile(id)] : []),
      ['WU', 'X4', 'WT'].includes(id)
        ? `coast-rain-v2-${id}-2026-10-11-2026-11-07.json.gz`
        : `xema-forecast-v2-${id}-2026-10-19-2026-11-01.json.gz`,
    ].flatMap(file => readRainArchive<ForecastArchiveRow[]>(file))
    const { capped } = buildForecastRequest(lat, lon, MODELS, METRICS, DEFAULT_FORECAST_DAYS)
    const modelIds = new Set(capped.map(m => m.id))
    const grouped = new Map<string, RainSample>()
    for (const row of forecast) {
      const value = row.predicted_value
      const actual = observed.get(row.valid_time)
      if (row.metric !== 'precipitation' || !offsets.includes(row.lead_time_hours / 24) ||
        !modelIds.has(row.model_id) || typeof actual !== 'number' || typeof value !== 'number' || !Number.isFinite(value)) continue
      const time = new Date(row.valid_time)
      if (time.getTime() - Date.parse(row.init_time) !== row.lead_time_hours * 3600000) throw new Error('Misaligned forecast')
      const key = `${row.valid_time}|${row.lead_time_hours}`
      const sample = grouped.get(key) ?? {
        time: row.valid_time, reference: row.init_time, day: precipitationDayKey(time), location: id, observed: actual,
        lead: row.lead_time_hours, factor: rainFactor(lat, lon, row.lead_time_hours, archiveDate), byModel: {},
      }
      sample.byModel[row.model_id] = value
      grouped.set(key, sample)
    }
    return [...grouped.values()]
  })
}

function daysOf(rows: RainSample[]): RainSample[][] {
  const groups = new Map<string, RainSample[]>()
  for (const row of rows) {
    const key = `${row.location}|${row.day}`
    const day = groups.get(key) ?? []
    day.push(row)
    groups.set(key, day)
  }
  return [...groups.values()].filter(day => day.length === 24)
}

function memberDailyTotals(rows: RainSample[]): TimedSample[] {
  return daysOf(rows).map(day => {
    const sums = new Map<string, { value: number; n: number }>()
    let observed = 0
    for (const hour of day) {
      observed += hour.observed
      for (const [id, value] of Object.entries(hour.byModel)) {
        const entry = sums.get(id) ?? { value: 0, n: 0 }
        entry.value += value
        entry.n++
        sums.set(id, entry)
      }
    }
    return { time: day[0].day, location: day[0].location, observed,
      byModel: Object.fromEntries([...sums].filter(([, entry]) => entry.n === 24).map(([id, entry]) => [id, entry.value])) }
  }).filter(day => Object.keys(day.byModel).length > 0)
}

function score(rows: RainSample[], forecast: Estimate) {
  const predicted = new Map<RainSample, number>()
  const samples: JoinedSample[] = rows.map(row => {
    const amount = forecast(row)
    predicted.set(row, amount)
    return { observed: row.observed, byModel: { ensemble: amount } }
  })
  let observed = 0, amount = 0, absolute = 0, heavy = 0
  const days = daysOf(rows)
  for (const day of days) {
    const actual = day.reduce((sum, row) => sum + row.observed, 0)
    const estimate = day.reduce((sum, row) => sum + predicted.get(row)!, 0)
    observed += actual
    amount += estimate
    absolute += Math.abs(actual - estimate)
    if (actual >= 5) heavy++
  }
  const hourly = ensembleError(samples, { ensemble: 1 }, null, wet)
  return { ...hourly, days: days.length, wetHours: hourly.hits + hourly.misses, daysAtLeast5mm: heavy,
    observedMm: observed, forecastMm: amount, dailyWape: observed > 0 ? absolute / observed : null,
    accumulatedError: observed > 0 ? Math.abs(amount - observed) / observed : null }
}

function estimate(config: Config): Estimate {
  return row => {
    const mean = predictMembers(row, config.weights) ?? 0
    let amount = mean
    if (config.aggregation !== 'mean') {
      const values = Object.entries(row.byModel).map(([id, value]) => ({ weight: config.weights[id] ?? 0, value }))
        .filter(member => member.weight > 0).sort((a, b) => a.value - b.value)
      const total = values.reduce((sum, member) => sum + member.weight, 0)
      let cumulative = 0
      const upper = values.find(member => {
        cumulative += member.weight
        return cumulative >= 0.75 * total
      })?.value ?? mean
      if (config.aggregation === 'winsorized' && total > 0) {
        const cap = Math.max(wet, upper * 2)
        const capped = values.reduce((sum, member) => sum + Math.min(member.value, cap) * member.weight, 0) / total
        amount = (mean + capped) / 2
      } else {
        amount = 0.65 * mean + 0.35 * upper
      }
    }
    const base = amount * (config.preserveLocal ? row.factor : 1)
    return config.scale * wet * (Math.max(0, base) / wet) ** config.exponent
  }
}

function objective(stats: ReturnType<typeof score>) {
  if (stats.dailyWape === null || stats.pod === null) return Infinity
  return stats.dailyWape + 0.3 * (1 - (stats.csi ?? 0)) +
    0.35 * Math.max(0, 0.8 - stats.pod) + 0.1 * Math.max(0, (stats.far ?? 1) - 0.6)
}

function select(fit: RainSample[], validation: RainSample[], weights: Weights, aggregations: Aggregation[]): Config {
  const equal = normalizeWeights(Object.fromEntries(Object.keys(weights).map(id => [id, 1])))
  const blends = {
    prior: weights,
    equal,
    hourly: fitJointWeights(fit, weights, 0.04),
    daily: fitJointWeights(memberDailyTotals(fit), weights, 0.04),
  }
  let best: Config = { weights, blend: 'prior', exponent: 1, scale: 1, preserveLocal: true, aggregation: 'mean' }
  let bestScore = objective(score(validation, estimate(best)))
  for (const [blend, members] of Object.entries(blends)) {
    for (const aggregation of aggregations) {
      for (const preserveLocal of [true, false]) {
        for (const exponent of [0.75, 1, 1.25]) {
          const initial = { weights: members, blend, preserveLocal, exponent, scale: 1, aggregation }
          const unscaled = score(fit, estimate(initial))
          const massScale = unscaled.forecastMm > 0 ? Math.max(0.35, Math.min(2, unscaled.observedMm / unscaled.forecastMm)) : 1
          for (const scale of [1, (1 + massScale) / 2, massScale]) {
            const config = { ...initial, scale }
            const loss = objective(score(validation, estimate(config)))
            if (loss < bestScore) {
              best = config
              bestScore = loss
            }
          }
        }
      }
    }
  }
  return best
}

function robustAmountScale(rows: RainSample[], forecast: Estimate): number {
  const ratios = daysOf(rows).flatMap(day => {
    const expected = day.reduce((sum, row) => sum + forecast(row), 0)
    const observed = day.reduce((sum, row) => sum + row.observed, 0)
    return expected > 0 ? [{ ratio: observed / expected, expected }] : []
  }).sort((a, b) => a.ratio - b.ratio)
  const total = ratios.reduce((sum, row) => sum + row.expected, 0)
  let cumulative = 0
  const median = ratios.find(row => {
    cumulative += row.expected
    return cumulative >= total / 2
  })?.ratio ?? 1
  return Math.max(0.35, Math.min(1.65, median))
}

function fitSeparateOutputs(fit: RainSample[], validation: RainSample[], weights: Weights, baseline: Estimate) {
  const features = (row: RainSample) => {
    let total = 0, vote = 0
    for (const [id, value] of Object.entries(row.byModel)) {
      const weight = weights[id] ?? 0
      total += weight
      if (value >= wet) vote += weight
    }
    return [1, Math.log1p((predictMembers(row, weights) ?? 0) / wet), total ? vote / total : 0]
  }
  const data = fit.map(row => ({ x: features(row), y: Number(row.observed >= wet) }))
  const rate = (data.reduce((sum, row) => sum + row.y, 0) + 1) / (data.length + 2)
  const beta = [Math.log(rate / (1 - rate)), 0, 0]
  const probability = (x: number[]) => 1 / (1 + Math.exp(-x.reduce((sum, value, i) => sum + value * beta[i], 0)))
  for (let step = 0; step < 320; step++) {
    const gradient = beta.map(() => 0)
    for (const { x, y } of data) {
      const residual = probability(x) - y
      x.forEach((value, i) => { gradient[i] += value * residual })
    }
    beta.forEach((value, i) => {
      const next = value - 0.55 * (gradient[i] / data.length + (i === 0 ? 0 : 0.015 * value))
      beta[i] = i === 0 ? next : Math.max(0, next)
    })
  }
  const signal = (row: RainSample) => probability(features(row))
  const scale = robustAmountScale(fit, baseline)
  const amountChoices = [1, (1 + scale) / 2, scale].map(factor => ({
    factor, loss: score(validation, row => baseline(row) * factor).dailyWape ?? Infinity,
  })).sort((a, b) => a.loss - b.loss)
  const thresholds = [0.03, 0.05, 0.075, 0.10, 0.125, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]
  const detected = (threshold: number, row: RainSample) => signal(row) >= threshold
  const choices = thresholds.map(threshold => {
    const stats = ensembleError(validation.map(row => ({ observed: row.observed, byModel: { detector: detected(threshold, row) ? wet : 0 } })),
      { detector: 1 }, null, wet)
    return { threshold, score: (stats.csi ?? 0) - 0.3 * Math.max(0, 0.8 - (stats.pod ?? 0)) -
      0.15 * Math.max(0, (stats.far ?? 1) - 0.6) }
  }).sort((a, b) => b.score - a.score)
  const threshold = choices[0].threshold
  const factor = amountChoices[0].factor
  return { factor, threshold, amount: (row: RainSample) => baseline(row) * factor, detect: (row: RainSample) => detected(threshold, row) }
}

function scoreSeparate(rows: RainSample[], amount: Estimate, detect: (row: RainSample) => boolean) {
  const statistics = score(rows, amount)
  const { hits, misses, falseAlarms, pod, far, csi } = ensembleError(rows.map(row => ({
    observed: row.observed, byModel: { detector: detect(row) ? wet : 0 },
  })), { detector: 1 }, null, wet)
  return { ...statistics, hits, misses, falseAlarms, pod, far, csi }
}

function pairedDailyWapeInterval(rows: RainSample[], baseline: Estimate, candidate: Estimate) {
  const byDate = new Map<string, { errorDelta: number; actual: number }>()
  for (const day of daysOf(rows)) {
    const actual = day.reduce((sum, row) => sum + row.observed, 0)
    const old = day.reduce((sum, row) => sum + baseline(row), 0)
    const proposed = day.reduce((sum, row) => sum + candidate(row), 0)
    const cell = byDate.get(day[0].day) ?? { errorDelta: 0, actual: 0 }
    cell.errorDelta += Math.abs(proposed - actual) - Math.abs(old - actual)
    cell.actual += actual
    byDate.set(day[0].day, cell)
  }
  const dates = [...byDate.keys()].sort()
  if (dates.length < 5) return null
  let seed = 179
  const draws: number[] = []
  for (let iteration = 0; iteration < 1000; iteration++) {
    let actual = 0, delta = 0
    for (let i = 0; i < dates.length; i += 2) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const start = (seed >>> 8) % (dates.length - 1)
      for (let j = 0; j < Math.min(2, dates.length - i); j++) {
        const block = byDate.get(dates[start + j])!
        actual += block.actual
        delta += block.errorDelta
      }
    }
    if (actual > 0) draws.push(delta / actual)
  }
  draws.sort((a, b) => a - b)
  return draws.length >= 800 ? { days: dates.length, blockDays: 2, low: draws[Math.floor(draws.length * 0.025)],
    high: draws[Math.floor(draws.length * 0.975)] } : null
}

function main() {
  const archive = loadRain()
  const results: Record<string, unknown> = {}
  for (const lead of offsets.map(day => day * 24)) {
    const rows = archive.filter(row => row.lead === lead)
    const raw = ensemblePresetWeights('precipitation', getLeadTimeBucket(lead))
    const prior = normalizeWeights(Object.fromEntries(MODELS.filter(m => m.id !== 'marine_global').map(m => [m.id, raw[m.id] ?? 0.01])))
    const baseline = estimate({ weights: prior, blend: 'prior', exponent: 1, scale: 1, preserveLocal: true, aggregation: 'mean' })
    const fit = rows.filter(row => row.time.slice(0, 10) <= fitThrough)
    const validation = rows.filter(row => row.time.slice(0, 10) >= validationFrom && row.time.slice(0, 10) <= validationThrough &&
      row.reference.slice(0, 10) > fitThrough)
    if (fit.length < 1000 || validation.length < 500) throw new Error(`Insufficient training at ${lead}h`)
    const config = select(fit, validation, prior, ['mean'])
    const candidate = estimate(config)
    const compare = (subset: RainSample[], estimate: Estimate = candidate) => ({
      baseline: score(subset, baseline), candidate: score(subset, estimate),
      dailyWapeDelta95: pairedDailyWapeInterval(subset, baseline, estimate),
    })
    const eligible = rows.filter(row => row.reference.slice(0, 10) > validationThrough && row.time.slice(0, 10) <= '2026-11-01')
    const temporal = compare(eligible.filter(row => fitStations.includes(row.location)))
    const spatial = compare(eligible.filter(row => spatialStations.includes(row.location)))
    const recent = compare(rows.filter(row => row.time.slice(0, 10) >= '2026-11-02'))
    const improves = ({ baseline: previous, candidate: next }: ReturnType<typeof compare>) =>
      next.wetHours >= 30 && next.days >= 20 && (next.dailyWape ?? Infinity) < (previous.dailyWape ?? Infinity) &&
      (next.pod ?? 0) >= (previous.pod ?? 0) && (next.csi ?? 0) >= (previous.csi ?? 0) &&
      (next.far ?? 1) <= Math.max(0.6, previous.far ?? 0)
    const accepted = improves(temporal) && improves(spatial) && (spatial.dailyWapeDelta95?.high ?? Infinity) < 0
    const meetsTarget = [temporal, spatial].every(({ candidate: next }) =>
      (next.pod ?? 0) >= 0.8 && (next.accumulatedError ?? Infinity) <= 0.2 && (next.far ?? 1) <= 0.6)
    const earlyFit = rows.filter(row => row.time.slice(0, 10) <= '2026-09-24')
    const earlyValidation = rows.filter(row => row.time.slice(0, 10) >= '2026-10-02' && row.time.slice(0, 10) <= '2026-10-10' &&
      row.reference.slice(0, 10) > '2026-09-24')
    const second = select(earlyFit, earlyValidation, prior, ['mean', 'winsorized', 'upperBlend'])
    const secondEstimate = estimate(second)
    const earlyTest = rows.filter(row => row.time.slice(0, 10) >= '2026-10-19' && row.time.slice(0, 10) <= '2026-11-01' &&
      row.reference.slice(0, 10) > '2026-10-10')
    const secondTemporal = compare(earlyTest.filter(row => fitStations.includes(row.location)), secondEstimate)
    const secondSpatial = compare(earlyTest.filter(row => spatialStations.includes(row.location)), secondEstimate)
    const secondRecent = compare(rows.filter(row => row.time.slice(0, 10) >= '2026-11-02'), secondEstimate)
    const secondAccepted = improves(secondTemporal) && improves(secondSpatial) && improves(secondRecent) &&
      (secondSpatial.dailyWapeDelta95?.high ?? Infinity) < 0
    const separate = fitSeparateOutputs(earlyFit, earlyValidation, prior, baseline)
    const separateCompare = (subset: RainSample[]) => ({
      baseline: score(subset, baseline), candidate: scoreSeparate(subset, separate.amount, separate.detect),
      dailyWapeDelta95: pairedDailyWapeInterval(subset, baseline, separate.amount),
    })
    const separateTemporal = separateCompare(earlyTest.filter(row => fitStations.includes(row.location)))
    const separateSpatial = separateCompare(earlyTest.filter(row => spatialStations.includes(row.location)))
    const separateRecent = separateCompare(rows.filter(row => row.time.slice(0, 10) >= '2026-11-02'))
    const separateAccepted = improves(separateTemporal) && improves(separateSpatial) && improves(separateRecent) &&
      (separateSpatial.dailyWapeDelta95?.high ?? Infinity) < 0
    results[lead] = { fit: fit.length, validation: validation.length, config, temporal, spatial, recent, accepted, meetsTarget,
      secondPass: { fit: earlyFit.length, validation: earlyValidation.length, config: second, temporal: secondTemporal, spatial: secondSpatial,
        recent: secondRecent, accepted: secondAccepted },
      separateOutputs: { factor: separate.factor, threshold: separate.threshold, temporal: separateTemporal, spatial: separateSpatial,
        recent: separateRecent, accepted: separateAccepted } }
    console.log(lead, config.blend, config.exponent, config.scale.toFixed(3), 'local?', config.preserveLocal,
      'POD/WAPE', [temporal, spatial, recent].map(x => [x.baseline.pod, x.candidate.pod, x.baseline.dailyWape, x.candidate.dailyWape].map(n => n?.toFixed(3))),
      'accepted', accepted, 'target', meetsTarget)
  }
  writeFileSync('docs/ensemble-rain-horizons-2026-11-11.json',
    JSON.stringify({ fitStations, spatialStations, fitThrough, validationFrom, validationThrough, results }, null, 2) + '\n')
}
main()

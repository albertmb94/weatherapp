#!/usr/bin/env tsx
/**
 * Recalibrate PRECIPITATION weights against real station skill.
 *
 *   npx tsx --env-file=.env.local scripts/calibratePrecipStations.ts 2026-08-09 2026-08-22 40 5
 *
 * Method — leave-STATIONS-out (not leave-locations-out over ERA5):
 *   1. Per (model, station) contingency at the 0.1 mm/h threshold from
 *      archived XEMA observations × archived Previous-Runs forecasts.
 *   2. For each fold, rank models by station CSI (1 − CSI, so lower is
 *      better) over the TRAINING stations and build Borda weights.
 *   3. Score the current ERA5 preset vs the station-trained weights on
 *      the HELD-OUT stations.
 *
 * Prints both, plus the weights trained on all stations, so the preset
 * is only changed when the held-out reality check supports it.
 */

import { getStationForecastArchive, getStationObservations } from '../lib/backtest/db'
import { ENSEMBLE_PRESETS, METRIC_TO_ENSEMBLE, getLeadTimeBucket } from '../lib/models'
import { assignFolds, bordaWeights, ensembleError, type AccuracySample, type ErrorStats, type JoinedSample } from '../lib/backtest/evalEnsemble'

const UI_BUCKETS = ['0-48h', '48-96h', '96-168h'] as const
const THRESHOLD = 0.1

interface Agg { hits: number; misses: number; fa: number }

function pool(): { sq: number; abs: number; n: number; hits: number; misses: number; fa: number } {
  return { sq: 0, abs: 0, n: 0, hits: 0, misses: 0, fa: 0 }
}
function add(p: ReturnType<typeof pool>, s: ErrorStats): void {
  if (!Number.isFinite(s.rmse) || s.n === 0) return
  p.sq += s.rmse * s.rmse * s.n
  p.abs += s.mae * s.n
  p.n += s.n
  p.hits += s.hits
  p.misses += s.misses
  p.fa += s.falseAlarms
}
function show(label: string, p: ReturnType<typeof pool>): void {
  if (p.n === 0) return console.log(`  ${label}: sin datos`)
  console.log(
    `  ${label.padEnd(16)} RMSE ${Math.sqrt(p.sq / p.n).toFixed(3)}  MAE ${(p.abs / p.n).toFixed(3)}  ` +
      `POD ${((p.hits / (p.hits + p.misses || 1)) * 100).toFixed(0)}%  FAR ${((p.fa / (p.hits + p.fa || 1)) * 100).toFixed(0)}%  ` +
      `CSI ${((p.hits / (p.hits + p.misses + p.fa || 1)) * 100).toFixed(0)}%  n=${p.n}`,
  )
}

async function main() {
  const [from, to = from, maxStations = '40', foldsArg = '5'] = process.argv.slice(2)
  if (!from) throw new Error('Usage: calibratePrecipStations.ts <from> <to> [maxStations] [folds]')
  const folds = Number(foldsArg)
  const metric = 'precipitation'

  const obs = await getStationObservations({ from: `${from}T00:00`, to: `${to}T23:59`, metrics: [metric], sources: ['xema'] })

  const byStation = new Map<string, {
    lat: number; lon: number
    obsByTime: Map<string, number>
    instances: Map<string, Map<string, JoinedSample>>
    modelAgg: Map<string, Agg>
  }>()
  for (const row of obs) {
    if (row.observed_value === null) continue
    const key = `${row.lat.toFixed(4)}|${row.lon.toFixed(4)}`
    let s = byStation.get(key)
    if (!s) {
      s = { lat: row.lat, lon: row.lon, obsByTime: new Map(), instances: new Map(), modelAgg: new Map() }
      byStation.set(key, s)
    }
    s.obsByTime.set(row.valid_time, row.observed_value)
  }
  const keys = [...byStation.keys()]
  const step = Math.max(1, Math.floor(keys.length / Number(maxStations)))
  const chosen = keys.filter((_, i) => i % step === 0).slice(0, Number(maxStations))

  for (const key of chosen) {
    const s = byStation.get(key)!
    const rows = await getStationForecastArchive(s.lat, s.lon, metric, `${from}T00:00`, `${to}T23:59`)
    for (const row of rows) {
      if (row.predicted_value === null) continue
      const observed = s.obsByTime.get(row.valid_time)
      if (observed === undefined) continue
      const bucket = getLeadTimeBucket(row.lead_time_hours)
      const ik = `${key}|${row.valid_time}`
      let insts = s.instances.get(bucket)
      if (!insts) { insts = new Map(); s.instances.set(bucket, insts) }
      let sample = insts.get(ik)
      if (!sample) { sample = { observed, byModel: {} }; insts.set(ik, sample) }
      sample.byModel[row.model_id] = row.predicted_value

      let agg = s.modelAgg.get(row.model_id)
      if (!agg) { agg = { hits: 0, misses: 0, fa: 0 }; s.modelAgg.set(row.model_id, agg) }
      const wet = observed >= THRESHOLD
      const predWet = row.predicted_value >= THRESHOLD
      if (predWet && wet) agg.hits++
      else if (!predWet && wet) agg.misses++
      else if (predWet && !wet) agg.fa++
    }
  }

  const withData = chosen.filter((k) => byStation.get(k)!.modelAgg.size > 0)
  const foldOf = assignFolds(withData, folds)
  const preset = ENSEMBLE_PRESETS.find((p) => p.id === METRIC_TO_ENSEMBLE[metric]) ?? ENSEMBLE_PRESETS[0]

  const totalsPreset = pool()
  const totalsTrained = pool()

  for (let f = 0; f < folds; f++) {
    const train = withData.filter((k) => foldOf.get(k) !== f)
    const test = withData.filter((k) => foldOf.get(k) === f)
    if (test.length === 0) continue

    const skillRows: AccuracySample[] = []
    for (const k of train) {
      const s = byStation.get(k)!
      for (const [modelId, agg] of s.modelAgg) {
        const denom = agg.hits + agg.misses + agg.fa
        if (denom === 0) continue
        skillRows.push({ model_id: modelId, lat: s.lat, lon: s.lon, rmse: 1 - agg.hits / denom })
      }
    }
    const trained = bordaWeights(skillRows)

    for (const bucket of UI_BUCKETS) {
      const samples: JoinedSample[] = []
      for (const k of test) {
        const insts = byStation.get(k)!.instances.get(bucket)
        if (insts) samples.push(...insts.values())
      }
      if (samples.length === 0) continue
      add(totalsPreset, ensembleError(samples, preset.weights[bucket] ?? {}))
      add(totalsTrained, ensembleError(samples, trained))
    }
  }

  // Weights trained on every station (for the proposal).
  const allSkill: AccuracySample[] = []
  for (const k of withData) {
    const s = byStation.get(k)!
    for (const [modelId, agg] of s.modelAgg) {
      const denom = agg.hits + agg.misses + agg.fa
      if (denom === 0) continue
      allSkill.push({ model_id: modelId, lat: s.lat, lon: s.lon, rmse: 1 - agg.hits / denom })
    }
  }
  const proposed = bordaWeights(allSkill)
  const rounded: Record<string, number> = {}
  for (const [k, v] of Object.entries(proposed)) rounded[k] = Math.round(v * 1000) / 1000

  console.log(`\nprecipitación · estaciones=${withData.length} · folds=${folds} · ${from}..${to}`)
  console.log('\n=== held-out (leave-STATIONS-out) ===')
  show('preset(ERA5)', totalsPreset)
  show('station:trained', totalsTrained)
  console.log(`\npesos propuestos (todas las estaciones): ${JSON.stringify(rounded)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

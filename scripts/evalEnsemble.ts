#!/usr/bin/env tsx
/**
 * Phase 0 — leave-locations-out evaluation of the ensemble.
 *
 *   npx tsx scripts/evalEnsemble.ts [metric] [folds]
 *
 * For every fold it derives weights from the OTHER folds
 * (`model_accuracy`), then scores the schemes on the held-out fold using
 * the RAW `forecast_archive` × `observations_era5` pairs. The number
 * reported is therefore a real ensemble RMSE, not a mean of RMSEs.
 *
 * Schemes compared:
 *   single:best      — the single best model on the training folds
 *   preset:alt       — the profile the metric used BEFORE per-metric weights
 *                      (precipitation for wind; temperature otherwise)
 *   preset:wedai     — the current `ENSEMBLE_PRESETS` weights
 *   borda:train      — per-location Borda weights from the training folds
 *   borda:train+bias — the above plus additive bias correction
 *
 * For precipitation, RMSE alone is misleading (it rewards models that
 * "dry out"), so POD / FAR / CSI are printed too, and everything is also
 * scored on the COMMON subset where the best single model has data — the
 * only apples-to-apples comparison.
 */

import { createClient } from '@libsql/client'
import { ENSEMBLE_PRESETS, METRIC_TO_ENSEMBLE, getLeadTimeBucket } from '../lib/models'
import { BACKTEST_BUCKET_TO_UI } from '../lib/backtest/config'
import {
  assignFolds,
  bestSingleModel,
  bordaWeights,
  ensembleError,
  locationKey,
  meanBias,
  type AccuracySample,
  type ErrorStats,
  type JoinedSample,
} from '../lib/backtest/evalEnsemble'
import { runStationTruth } from '../lib/backtest/stationVerify'

const DB_URL = process.env.BACKTEST_DB_URL ?? 'file:local.db'
const UI_BUCKETS = ['0-48h', '48-96h', '96-168h'] as const

interface RawRow {
  lat: number
  lon: number
  valid_time: string
  lead_time_hours: number
  model_id: string
  predicted_value: number
  observed_value: number
}

interface Pool {
  sq: number
  abs: number
  n: number
  hits: number
  misses: number
  falseAlarms: number
}

function pool(): Pool {
  return { sq: 0, abs: 0, n: 0, hits: 0, misses: 0, falseAlarms: 0 }
}

function addTo(p: Pool, s: ErrorStats): void {
  if (!Number.isFinite(s.rmse) || s.n === 0) return
  p.sq += s.rmse * s.rmse * s.n
  p.abs += s.mae * s.n
  p.n += s.n
  p.hits += s.hits
  p.misses += s.misses
  p.falseAlarms += s.falseAlarms
}

function report(title: string, totals: Record<string, Pool>, baseKey: string): void {
  const base = totals[baseKey]
  const baseRmse = base && base.n > 0 ? Math.sqrt(base.sq / base.n) : null
  console.log(`\n=== ${title} ===`)
  for (const [scheme, p] of Object.entries(totals)) {
    if (p.n === 0) continue
    const rmse = Math.sqrt(p.sq / p.n)
    const mae = p.abs / p.n
    const delta = baseRmse ? ((rmse - baseRmse) / baseRmse) * 100 : 0
    const cat = p.hits + p.misses + p.falseAlarms > 0
      ? `  POD ${((p.hits / (p.hits + p.misses || 1)) * 100).toFixed(1)}%  FAR ${((p.falseAlarms / (p.hits + p.falseAlarms || 1)) * 100).toFixed(1)}%  CSI ${((p.hits / (p.hits + p.misses + p.falseAlarms)) * 100).toFixed(1)}%`
      : ''
    const rel = scheme === baseKey ? '' : `  (${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% RMSE)`
    console.log(`${scheme.padEnd(18)} RMSE ${rmse.toFixed(4)}  MAE ${mae.toFixed(4)}  n=${p.n}${rel}${cat}`)
  }
}

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function printStationResult(res: Awaited<ReturnType<typeof runStationTruth>>): void {
  const cat = (s: { pod: number | null; far: number | null; csi: number | null }) =>
    s.csi === null
      ? ''
      : `  POD ${((s.pod ?? 0) * 100).toFixed(0)}%  FAR ${((s.far ?? 0) * 100).toFixed(0)}%  CSI ${((s.csi ?? 0) * 100).toFixed(0)}%`
  console.log(`\n=== TRUTH = STATION (XEMA) · ${res.metric} · estaciones=${res.stations} · instancias=${res.instances} ===`)
  for (const b of res.perBucket) {
    console.log(`  ${b.bucket}`)
    console.log(`    preset(ERA5-w)  RMSE ${b.preset.rmse.toFixed(3)}  MAE ${b.preset.mae.toFixed(3)}  n=${b.preset.n}${cat(b.preset)}`)
    console.log(`    era5:borda      RMSE ${b.era5borda.rmse.toFixed(3)}  MAE ${b.era5borda.mae.toFixed(3)}  n=${b.era5borda.n}${cat(b.era5borda)}`)
    console.log(`    station:skill   RMSE ${b.stationCsi.rmse.toFixed(3)}  MAE ${b.stationCsi.mae.toFixed(3)}  n=${b.stationCsi.n}${cat(b.stationCsi)}`)
  }
  console.log(`  pesos propuestos (skill estación): ${JSON.stringify(res.proposedWeights)}`)
}

async function main() {
  const positionals = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const metric = positionals[0] ?? 'temperature'
  const folds = Number(positionals[1] ?? '5')
  const truth = flag('truth') ?? 'era5'
  const from = flag('from') ?? '2026-08-15'
  const to = flag('to') ?? from
  const maxStations = Number(flag('stations') ?? '12')
  const db = createClient({ url: DB_URL })

  // Station truth first (it is the reality check); ERA5 ranking follows
  // unless the caller asked for station truth only. Both are printed
  // separately on purpose — mixing them is exactly the mistake this
  // evaluator exists to prevent.
  if (truth === 'station' || truth === 'both') {
    const res = await runStationTruth({ metric, from, to, maxStations, log: (m) => console.log(m) })
    printStationResult(res)
    if (truth === 'station') return
  }

  const acc = await db.execute({
    sql: `SELECT model_id, lat, lon, lead_time_bucket, rmse, bias, sample_count
          FROM model_accuracy WHERE metric = ?`,
    args: [metric],
  })
  const accRows: (AccuracySample & { uiBucket: string })[] = []
  for (const r of acc.rows) {
    const uiBucket = BACKTEST_BUCKET_TO_UI[String(r.lead_time_bucket)]
    if (!uiBucket) continue
    accRows.push({
      model_id: String(r.model_id),
      lat: Number(r.lat),
      lon: Number(r.lon),
      rmse: r.rmse === null ? null : Number(r.rmse),
      bias: r.bias === null ? null : Number(r.bias),
      sample_count: r.sample_count === null ? 0 : Number(r.sample_count),
      uiBucket,
    })
  }
  const locations = [...new Set(accRows.map((r) => locationKey(r.lat, r.lon)))]
  const foldOf = assignFolds(locations, folds)

  const presetId = METRIC_TO_ENSEMBLE[metric] ?? 'temperature'
  const preset = ENSEMBLE_PRESETS.find((p) => p.id === presetId) ?? ENSEMBLE_PRESETS[0]
  const altPreset = ENSEMBLE_PRESETS.find((p) => p.id === (metric === 'wind_speed' ? 'precipitation' : 'temperature'))!

  console.log(`\nmetric=${metric}  folds=${folds}  locations=${locations.length}`)

  const totals: Record<string, Pool> = {}
  const common: Record<string, Pool> = {}

  for (let f = 0; f < folds; f++) {
    const trainRows = accRows.filter((r) => foldOf.get(locationKey(r.lat, r.lon)) !== f)
    const testLocs = locations.filter((k) => foldOf.get(k) === f)
    if (testLocs.length === 0) continue

    const bordaByBucket: Record<string, Record<string, number>> = {}
    const biasByBucket: Record<string, Record<string, number>> = {}
    for (const bucket of UI_BUCKETS) {
      const rows = trainRows.filter((r) => r.uiBucket === bucket)
      bordaByBucket[bucket] = bordaWeights(rows)
      biasByBucket[bucket] = meanBias(rows)
    }
    const bestModel = bestSingleModel(trainRows)

    const locClause = testLocs.map(() => '(f.lat = ? AND f.lon = ?)').join(' OR ')
    const rawArgs: (string | number)[] = [metric]
    for (const key of testLocs) {
      const [la, lo] = key.split('|')
      rawArgs.push(Number(la), Number(lo))
    }
    const raw = await db.execute({
      sql: `SELECT f.lat, f.lon, f.valid_time, f.lead_time_hours, f.model_id,
                   f.predicted_value, o.observed_value
            FROM forecast_archive f
            JOIN observations_era5 o
              ON o.lat = f.lat AND o.lon = f.lon AND o.valid_time = f.valid_time
                 AND o.metric = f.metric
            WHERE f.metric = ?
              AND f.predicted_value IS NOT NULL
              AND o.observed_value IS NOT NULL
              AND (${locClause})`,
      args: rawArgs,
    })

    const groups = new Map<string, { sample: JoinedSample; lead: number }>()
    for (const row of raw.rows as unknown as RawRow[]) {
      const key = `${row.lat}|${row.lon}|${row.valid_time}|${row.lead_time_hours}`
      let entry = groups.get(key)
      if (!entry) {
        entry = { sample: { observed: Number(row.observed_value), byModel: {} }, lead: row.lead_time_hours }
        groups.set(key, entry)
      }
      entry.sample.byModel[String(row.model_id)] = Number(row.predicted_value)
    }

    const byBucket = new Map<string, JoinedSample[]>()
    for (const { sample, lead } of groups.values()) {
      const bucket = getLeadTimeBucket(lead)
      const list = byBucket.get(bucket) ?? []
      list.push(sample)
      byBucket.set(bucket, list)
    }

    for (const bucket of UI_BUCKETS) {
      const samples = byBucket.get(bucket) ?? []
      if (samples.length === 0) continue
      const fairSamples = bestModel
        ? samples.filter((s) => s.byModel[bestModel] !== undefined)
        : []

      const presetWeights = preset.weights[bucket] ?? preset.weights['0-48h'] ?? {}
      const altWeights = altPreset.weights[bucket] ?? altPreset.weights['0-48h'] ?? {}
      const borda = bordaByBucket[bucket] ?? {}
      const bias = biasByBucket[bucket] ?? {}

      const schemes: [string, (xs: JoinedSample[]) => ErrorStats][] = [
        ['single:best', (xs) => ensembleError(xs, bestModel ? { [bestModel]: 1 } : {})],
        ['preset:alt', (xs) => ensembleError(xs, altWeights)],
        ['preset:wedai', (xs) => ensembleError(xs, presetWeights)],
        ['borda:train', (xs) => ensembleError(xs, borda)],
        ['borda:train+bias', (xs) => ensembleError(xs, borda, bias)],
      ]
      for (const [scheme, fn] of schemes) {
        addTo((totals[scheme] ??= pool()), fn(samples))
        if (fairSamples.length > 0) addTo((common[scheme] ??= pool()), fn(fairSamples))
      }
    }
  }

  report('held-out totals (all instances)', totals, 'single:best')
  report('held-out totals · COMMON subset (same instances for every scheme)', common, 'single:best')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

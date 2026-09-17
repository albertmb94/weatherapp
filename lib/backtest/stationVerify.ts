/**
 * Station-truth verification shared by the evaluators.
 *
 * The ERA5 backtest can only rank models globally; a real station is the
 * only way to verify absolute skill, and the two disagree sharply
 * (measured 2026-08-15: ERA5 +2.1 °C and ×3.4 the rain vs XEMA). This
 * module joins archived station observations with Previous-Runs forecasts
 * at the station coordinates and returns, per method:
 *
 *   - `preset`     : the ERA5-calibrated weights currently in the app
 *   - `era5borda`  : weights ranked on ERA5 `model_accuracy` (global)
 *   - `stationCsi` : weights ranked on station skill (CSI for rain,
 *                    RMSE for temperature) — the "calibrate against
 *                    reality" candidate
 *
 * so the same forecasts are scored under every method against reality.
 */

import { getModelAccuracyByTerrain, getStationForecastArchive, getStationObservations, type StationObservationRow } from './db'
import { fetchPreviousRuns } from './fetchPreviousRuns'
import { ENSEMBLE_PRESETS, METRIC_TO_ENSEMBLE, getLeadTimeBucket, type EnsemblePreset } from '../models'
import type { BacktestLocation } from './config'
import {
  bordaWeights,
  ensembleError,
  type AccuracySample,
  type ErrorStats,
  type JoinedSample,
} from './evalEnsemble'

export interface BucketSamples {
  bucket: string
  samples: JoinedSample[]
}

/** Fine verification buckets stored in `model_accuracy`. */
const FINE_BUCKETS = ['0-24h', '24-48h', '48-72h', '72-96h', '96-120h', '120-168h'] as const

export interface StationTruthResult {
  metric: string
  stations: number
  instances: number
  perBucket: {
    bucket: string
    preset: ErrorStats
    era5borda: ErrorStats
    stationCsi: ErrorStats
  }[]
  /** Weights the station skill ranking proposes for the metric. */
  proposedWeights: Record<string, Record<string, number>>
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Previous Runs with backoff — the API 429s aggressively per station. */
async function fetchWithRetry(
  location: BacktestLocation,
  from: string,
  to: string,
  attempts = 4,
): Promise<Awaited<ReturnType<typeof fetchPreviousRuns>>> {
  let wait = 800
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchPreviousRuns(location, from, to)
    } catch (err) {
      if (i === attempts - 1) throw err
      await sleep(wait)
      wait *= 2
    }
  }
  return []
}

function stationKey(row: StationObservationRow): string {
  return `${row.station_id}|${row.lat.toFixed(4)}|${row.lon.toFixed(4)}`
}

export interface RunStationTruthOptions {
  metric: string
  from: string
  to: string
  /** Cap on stations fetched (each triggers a Previous Runs request). */
  maxStations?: number
  log?: (msg: string) => void
}

export async function runStationTruth(opts: RunStationTruthOptions): Promise<StationTruthResult> {
  const { metric, from, to } = opts
  const maxStations = opts.maxStations ?? 12
  const log = opts.log ?? (() => {})

  const obs = await getStationObservations({
    from: `${from}T00:00`,
    to: `${to}T23:59`,
    metrics: [metric],
    sources: ['xema'],
  })

  // Group observations per station coordinate.
  const stations = new Map<string, { lat: number; lon: number; name: string; byTime: Map<string, number> }>()
  for (const row of obs) {
    if (row.observed_value === null) continue
    const key = stationKey(row)
    let entry = stations.get(key)
    if (!entry) {
      entry = { lat: row.lat, lon: row.lon, name: row.station_name ?? row.station_id, byTime: new Map() }
      stations.set(key, entry)
    }
    entry.byTime.set(row.valid_time, row.observed_value)
  }

  const chosen = [...stations.entries()].slice(0, maxStations)
  const byBucket = new Map<string, Map<string, JoinedSample>>()
  // Per (model, station) skill aggregates for the station ranking.
  const modelStation = new Map<string, { sq: number; n: number; hits: number; misses: number; fa: number; lat: number; lon: number }>()
  const isRain = metric === 'precipitation'

  for (const [key, station] of chosen) {
    const location: BacktestLocation = {
      name: station.name,
      lat: station.lat,
      lon: station.lon,
      terrain: 'coastal',
      country: 'ES',
    }
    let rows
    try {
      // Prefer the DB archive (fast, no rate limits); fall back to a live
      // fetch only when the station window was never archived.
      rows = await getStationForecastArchive(
        station.lat,
        station.lon,
        metric,
        `${from}T00:00`,
        `${to}T23:59`,
      )
      if (rows.length === 0) {
        rows = await fetchWithRetry(location, from, to)
      }
    } catch (err) {
      log(`  ${station.name}: sin forecast (${(err as Error).message})`)
      continue
    }
    if (rows.length === 0) {
      log(`  ${station.name}: sin forecasts (archiva con archiveStationForecasts.ts)`)
      continue
    }

    for (const row of rows) {
      if (row.metric !== metric || row.predicted_value === null) continue
      const observed = station.byTime.get(row.valid_time)
      if (observed === undefined) continue
      const bucket = getLeadTimeBucket(row.lead_time_hours)
      const instanceKey = `${key}|${row.valid_time}`
      let instances = byBucket.get(bucket)
      if (!instances) {
        instances = new Map()
        byBucket.set(bucket, instances)
      }
      let sample = instances.get(instanceKey)
      if (!sample) {
        sample = { observed, byModel: {} }
        instances.set(instanceKey, sample)
      }
      sample.byModel[row.model_id] = row.predicted_value

      const pk = `${row.model_id}|${key}`
      let agg = modelStation.get(pk)
      if (!agg) {
        agg = { sq: 0, n: 0, hits: 0, misses: 0, fa: 0, lat: station.lat, lon: station.lon }
        modelStation.set(pk, agg)
      }
      const err = row.predicted_value - observed
      agg.sq += err * err
      agg.n++
      const wet = observed >= 0.1
      const predWet = row.predicted_value >= 0.1
      if (predWet && wet) agg.hits++
      else if (!predWet && wet) agg.misses++
      else if (predWet && !wet) agg.fa++
    }
  }

  // Station-skill ranking: RMSE for temperature, -CSI for rain (so "lower
  // is better" holds for the shared Borda scorer).
  const skillRows: AccuracySample[] = []
  for (const [pk, agg] of modelStation) {
    if (agg.n === 0) continue
    const [model_id] = pk.split('|')
    let skill: number
    if (isRain) {
      const denom = agg.hits + agg.misses + agg.fa
      // No rain and no false alarms at this station = no skill signal.
      if (denom === 0) continue
      // 1 − CSI is in [0, 1] with LOWER better, so the shared Borda
      // scorer (which rejects non-positive "rmse") can rank it.
      skill = 1 - agg.hits / denom
    } else {
      skill = Math.sqrt(agg.sq / agg.n)
    }
    skillRows.push({ model_id, lat: agg.lat, lon: agg.lon, rmse: skill })
  }
  const stationWeights = bordaWeights(skillRows)

  // ERA5-based ranking for the same metric (global reference).
  const era5Rows: AccuracySample[] = []
  const terrains = ['coastal', 'urban', 'mountain', 'flat', 'island', 'river_valley']
  for (let t = 0; t < terrains.length; t++) {
    const rows = await getModelAccuracyByTerrain(terrains[t], metric, FINE_BUCKETS, { topN: 50 })
    for (const r of rows) {
      if (r.rmse === null) continue
      // Aggregated rows carry no coordinates; give each terrain its own
      // synthetic location so Borda ranks across terrains, not within one.
      era5Rows.push({ model_id: r.model_id, lat: 0, lon: t, rmse: r.rmse })
    }
  }
  const era5Weights = bordaWeights(era5Rows)

  const presetId: EnsemblePreset = METRIC_TO_ENSEMBLE[metric] ?? 'temperature'
  const preset = ENSEMBLE_PRESETS.find((p) => p.id === presetId) ?? ENSEMBLE_PRESETS[0]

  const perBucket: StationTruthResult['perBucket'] = []
  for (const bucket of ['0-48h', '48-96h', '96-168h']) {
    const instances = byBucket.get(bucket)
    if (!instances || instances.size === 0) continue
    const samples = [...instances.values()]
    perBucket.push({
      bucket,
      preset: ensembleError(samples, preset.weights[bucket] ?? {}),
      era5borda: ensembleError(samples, era5Weights),
      stationCsi: ensembleError(samples, stationWeights),
    })
  }

  const instances = [...byBucket.values()].reduce((a, m) => a + m.size, 0)
  return {
    metric,
    stations: chosen.length,
    instances,
    perBucket,
    proposedWeights: { [metric]: erWeightsRounded(stationWeights) },
  }
}

function erWeightsRounded(w: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(w)) out[k] = Math.round(v * 1000) / 1000
  return out
}

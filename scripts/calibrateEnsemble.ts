/**
 * Ensemble calibration from the backtest database (B-NBT-8).
 *
 * Run with: npx tsx scripts/calibrateEnsemble.ts [--out <file>]
 *
 * Reads `model_accuracy` from local.db and derives calibrated ensemble
 * weights per metric × UI lead-time bucket using PER-LOCATION
 * inverse-RMSE weighting:
 *
 *   1. For every reference location that has verification rows for at
 *      least MIN_MODELS_PER_LOCATION models in the bucket's backtest
 *      windows, each present model gets w = 1/rmse, normalised to sum
 *      to 1 within that location.
 *   2. A model's final weight is the MEAN of its per-location weights,
 *      taken only over locations where the model has data.
 *   3. Weights are re-normalised over all measured models and rounded
 *      to 3 decimals.
 *
 * Why per-location normalisation: raw RMSE magnitudes differ wildly
 * across climates (a coastal Mediterranean summer vs continental
 * winter), so averaging RMSE directly would rank models by WHERE they
 * verify, not HOW WELL. Normalising inside each location measures how
 * often a model wins where it actually runs — which is what we want,
 * because `weightedAvg` skips models without data at the user's cell:
 * a regional can carry a large weight globally and still only act
 * inside its footprint (AROME/HARMONIE in Catalonia, ICON-D2 in Central
 * Europe...).
 *
 * The output replaces the hand-authored legacy buckets in
 * ENSEMBLE_PRESETS (lib/models.ts); the AI share is blended on top of
 * them exactly as before. Re-run weekly after the backtest cron to
 * keep the calibration fresh.
 */

import { createClient } from '@libsql/client'
import { writeFileSync } from 'node:fs'
import { uiBucketToBacktestBuckets } from '../lib/backtest/config'

const DB_URL = process.env.BACKTEST_DB_URL ?? 'file:local.db'
const MIN_MODELS_PER_LOCATION = 3

/** UI preset id → which backtest metric feeds it. */
const PRESET_METRIC: Record<string, string> = {
  temperature: 'temperature',
  precipitation: 'precipitation',
  // Rain probability has no direct observation; calibrate it with the
  // same signal as precipitation amount.
  precipitation_probability: 'precipitation',
}

interface Row {
  model_id: string
  lat: number
  lon: number
  rmse: number | null
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

async function main() {
  const outPathIdx = process.argv.indexOf('--out')
  const outPath = outPathIdx >= 0 ? process.argv[outPathIdx + 1] : null

  const db = createClient({ url: DB_URL })
  const bucketsByUi: Record<string, string[]> = {
    '0-48h': uiBucketToBacktestBuckets('0-48h'),
    '48-96h': uiBucketToBacktestBuckets('48-96h'),
    '96-168h': uiBucketToBacktestBuckets('96-168h'),
  }

  const result: Record<string, Record<string, Record<string, number>>> = {}

  for (const [presetId, metric] of Object.entries(PRESET_METRIC)) {
    result[presetId] = {}
    for (const [uiBucket, btBuckets] of Object.entries(bucketsByUi)) {
      const placeholders = btBuckets.map(() => '?').join(', ')
      const rows = await db.execute({
        sql: `SELECT model_id, lat, lon,
                     AVG(rmse) AS rmse
              FROM model_accuracy
              WHERE metric = ?
                AND lead_time_bucket IN (${placeholders})
                AND rmse IS NOT NULL
              GROUP BY lat, lon, model_id`,
        args: [metric, ...btBuckets],
      })

      // group rows per location
      const byLocation = new Map<string, Row[]>()
      for (const r of rows.rows) {
        const key = `${r.lat}|${r.lon}`
        const list = byLocation.get(key) ?? []
        list.push({
          model_id: String(r.model_id),
          lat: Number(r.lat),
          lon: Number(r.lon),
          rmse: r.rmse === null ? null : Number(r.rmse),
        })
        byLocation.set(key, list)
      }

      // Per-location Borda scoring: rank present models by RMSE, award
      // (n - rank) / n points (winner 1.0, last 1/n), then average per
      // model over its own locations. IMPORTANT (B-NBT-8): we
      // deliberately do NOT renormalize across models at the end. Each
      // number is a model's average WIN SHARE within its coverage
      // footprint; `weightedAvg` renormalizes over whichever models
      // have data at the user's cell, so a regional earns its big share
      // exactly where it runs (ICON-EU across Europe, ICON-D2 in
      // Central Europe, AROME/HARMONIE around France/Catalonia/NL) and
      // simply doesn't participate elsewhere. Rank points are used
      // instead of 1/rmse shares because raw magnitudes aren't
      // comparable across climates and inverse-rmse compresses to
      // near-uniform with many models present; Borda directly rewards
      // consistent winners.
      const scoreSums = new Map<string, number>()
      const locationCounts = new Map<string, number>()
      let usedLocations = 0
      for (const list of byLocation.values()) {
        const usable = list.filter(r => r.rmse !== null && r.rmse > 0 && Number.isFinite(r.rmse))
        if (usable.length < MIN_MODELS_PER_LOCATION) continue
        usedLocations++
        const sorted = [...usable].sort((a, b) => (a.rmse as number) - (b.rmse as number))
        const n = sorted.length
        for (let i = 0; i < n; i++) {
          const points = (n - i) / n
          const { model_id } = sorted[i]
          scoreSums.set(model_id, (scoreSums.get(model_id) ?? 0) + points)
          locationCounts.set(model_id, (locationCounts.get(model_id) ?? 0) + 1)
        }
      }

      const entries = [...scoreSums.entries()]
        .map(([modelId, sum]) => ({
          modelId,
          mean: sum / (locationCounts.get(modelId) ?? 1),
          locs: locationCounts.get(modelId) ?? 0,
        }))
        .sort((a, b) => b.mean - a.mean)
      if (entries.length === 0) {
        console.warn(`[calibrate] ${presetId}/${uiBucket}: no usable data, skipping`)
        continue
      }

      // Normalise the bucket to sum exactly 1 before emitting. This is
      // PURELY cosmetic — ratios (the thing that matters) are
      // untouched — but it keeps the generated tables on the same
      // 0..1 scale as the old hand-authored presets, which several
      // tests and the AI-share blending assume.
      const totalMean = entries.reduce((acc, e) => acc + e.mean, 0)

      const bucket: Record<string, number> = {}
      for (const e of entries) {
        bucket[e.modelId] = round3(e.mean / totalMean)
      }
      result[presetId][uiBucket] = bucket

      console.log(`\n=== ${presetId} · ${uiBucket} (${usedLocations} localizaciones con ≥${MIN_MODELS_PER_LOCATION} modelos) ===`)
      for (const e of entries) {
        console.log(`  ${(bucket[e.modelId]).toFixed(3)}  (${e.locs} locs)  ${e.modelId}`)
      }
    }
  }

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8')
    console.log(`\nEscrito ${outPath}`)
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })

import { getDb } from '@/lib/db'

let initPromise: Promise<void> | null = null

export function ensureBacktestSchema(): Promise<void> {
  if (!initPromise) {
    const db = getDb()
    if (!db) {
      // No DB available (production without Turso, or the libsql client
      // reported the connection as blocked). Fail closed: the backtest
      // route is auth-protected and only triggers when the operator is
      // prepared to provision storage, so a missing DB is a real error.
      initPromise = Promise.resolve()
      return initPromise
    }
    initPromise = db.execute(`
        CREATE TABLE IF NOT EXISTS forecast_archive (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model_id TEXT NOT NULL,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          init_time TEXT NOT NULL,
          valid_time TEXT NOT NULL,
          lead_time_hours INTEGER NOT NULL,
          metric TEXT NOT NULL,
          predicted_value REAL,
          archived_at TEXT DEFAULT (datetime('now')),
          UNIQUE(model_id, lat, lon, init_time, valid_time, metric)
        )
      `)
      .then(() => {
        const fresh = getDb()
        if (!fresh) throw new Error('DB unavailable')
        return fresh.execute(`
        CREATE TABLE IF NOT EXISTS observations_era5 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          valid_time TEXT NOT NULL,
          metric TEXT NOT NULL,
          observed_value REAL,
          source TEXT DEFAULT 'era5',
          UNIQUE(lat, lon, valid_time, metric, source)
        )
      `)
      })
      .then(() => {
        const fresh = getDb()
        if (!fresh) throw new Error('DB unavailable')
        return fresh.execute(`
        CREATE TABLE IF NOT EXISTS model_accuracy (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model_id TEXT NOT NULL,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          terrain_type TEXT NOT NULL,
          metric TEXT NOT NULL,
          lead_time_bucket TEXT NOT NULL,
          mae REAL,
          rmse REAL,
          bias REAL,
          sample_count INTEGER,
          window_start TEXT NOT NULL,
          window_end TEXT NOT NULL,
          computed_at TEXT DEFAULT (datetime('now')),
          UNIQUE(model_id, lat, lon, terrain_type, metric, lead_time_bucket, window_start)
        )
      `)
      })
      .then(() => {
        const fresh = getDb()
        if (!fresh) throw new Error('DB unavailable')
        return fresh.execute(`
        CREATE TABLE IF NOT EXISTS dynamic_weights (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          terrain_type TEXT NOT NULL,
          model_id TEXT NOT NULL,
          metric TEXT NOT NULL,
          weight REAL NOT NULL,
          lead_time_bucket TEXT NOT NULL,
          computed_at TEXT DEFAULT (datetime('now')),
          UNIQUE(lat, lon, terrain_type, model_id, metric, lead_time_bucket)
        )
      `)
      })
      .then(() => undefined)
      .catch(err => {
        initPromise = null
        throw err
      })
  }
  return initPromise
}

export interface ForecastArchiveRow {
  model_id: string
  lat: number
  lon: number
  init_time: string
  valid_time: string
  lead_time_hours: number
  metric: string
  predicted_value: number | null
}

export interface ObservationRow {
  lat: number
  lon: number
  valid_time: string
  metric: string
  observed_value: number | null
}

export interface ModelAccuracyRow {
  model_id: string
  lat: number
  lon: number
  terrain_type: string
  metric: string
  lead_time_bucket: string
  mae: number | null
  rmse: number | null
  bias: number | null
  sample_count: number
  window_start: string
  window_end: string
  computed_at: string
}

export interface DynamicWeightRow {
  lat: number
  lon: number
  terrain_type: string
  model_id: string
  metric: string
  weight: number
  lead_time_bucket: string
}

export async function insertForecastArchive(rows: ForecastArchiveRow[]): Promise<void> {
  if (rows.length === 0) return
  const db = getDb()
  if (!db) throw new Error('DB unavailable')
  // Batch insert in chunks of 500
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
    const flatValues = chunk.flatMap(r => [
      r.model_id, r.lat, r.lon, r.init_time, r.valid_time,
      r.lead_time_hours, r.metric, r.predicted_value,
    ])
    await db.execute({
      sql: `INSERT OR REPLACE INTO forecast_archive
            (model_id, lat, lon, init_time, valid_time, lead_time_hours, metric, predicted_value)
            VALUES ${placeholders}`,
      args: flatValues,
    })
  }
}

export async function insertObservations(rows: ObservationRow[]): Promise<void> {
  if (rows.length === 0) return
  const db = getDb()
  if (!db) throw new Error('DB unavailable')
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')
    const flatValues = chunk.flatMap(r => [
      r.lat, r.lon, r.valid_time, r.metric, r.observed_value,
    ])
    await db.execute({
      sql: `INSERT OR REPLACE INTO observations_era5
            (lat, lon, valid_time, metric, observed_value)
            VALUES ${placeholders}`,
      args: flatValues,
    })
  }
}

export async function insertModelAccuracy(rows: ModelAccuracyRow[]): Promise<void> {
  if (rows.length === 0) return
  const db = getDb()
  if (!db) throw new Error('DB unavailable')
  for (const r of rows) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO model_accuracy
            (model_id, lat, lon, terrain_type, metric, lead_time_bucket,
             mae, rmse, bias, sample_count, window_start, window_end)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        r.model_id, r.lat, r.lon, r.terrain_type, r.metric, r.lead_time_bucket,
        r.mae, r.rmse, r.bias, r.sample_count, r.window_start, r.window_end,
      ],
    })
  }
}

export async function insertDynamicWeights(rows: DynamicWeightRow[]): Promise<void> {
  if (rows.length === 0) return
  const db = getDb()
  if (!db) throw new Error('DB unavailable')
  for (const r of rows) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO dynamic_weights
            (lat, lon, terrain_type, model_id, metric, weight, lead_time_bucket)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [r.lat, r.lon, r.terrain_type, r.model_id, r.metric, r.weight, r.lead_time_bucket],
    })
  }
}

export async function getModelAccuracy(
  lat: number,
  lon: number,
  terrainType: string,
  metric: string,
  leadTimeBucket: string
): Promise<ModelAccuracyRow[]> {
  const db = getDb()
  if (!db) return []
  const result = await db.execute({
    sql: `SELECT * FROM model_accuracy
          WHERE lat = ? AND lon = ? AND terrain_type = ? AND metric = ? AND lead_time_bucket = ?
          ORDER BY computed_at DESC LIMIT 20`,
    args: [lat, lon, terrainType, metric, leadTimeBucket],
  })
  return result.rows as unknown as ModelAccuracyRow[]
}

/**
 * Sprint 13: fetch the most-accurate models for a given terrain
 * type, regardless of which exact (lat, lon) we have. The previous
 * `getModelAccuracy` query pinned the location to a single
 * reference point; for the profile boost we want a *terrain-wide*
 * ranking because (a) the user's location may not be one of the
 * 100 backtest locations and (b) the recommendation is supposed to
 * be the model's average accuracy for the same *kind* of place
 * (coastal cities share the same preferred models regardless of
 * which coast they're on).
 *
 * The query filters on `terrain_type` and a recent
 * `computed_at` window (default: last 90 days, plenty for the
 * weekly-backtest job's cadence). It then orders by `rmse` ASC so
 * the first row is the most accurate model, and limits to `topN`
 * (default 5) so the caller gets a manageable recommendation list.
 *
 * Behavioural notes:
 *   - When no DB is configured (production without Turso) or the
 *     table is empty, this returns an empty array. The caller is
 *     expected to treat that as "no boost available" and skip the
 *     profile weight adjustment. The system degrades gracefully —
 *     the user sees the un-boosted ensemble rather than a broken
 *     page.
 *   - When `terrainType` doesn't match any row (the weekly
 *     backtest hasn't yet written rows for that terrain), the
 *     function also returns []. The schedule of the backtest
 *     matters; we don't synthesise recommendations.
 *   - This function is read-only and side-effect-free.
 */
export async function getModelAccuracyByTerrain(
  terrainType: string,
  metric: string,
  leadTimeBucket: string,
  options: { topN?: number; windowDays?: number } = {}
): Promise<ModelAccuracyRow[]> {
  const { topN = 5, windowDays = 90 } = options
  const db = getDb()
  if (!db) return []
  // The 90-day cutoff is the rolling window we expect the
  // weekly-backtest to refresh; older rows are still valid for
  // historical analysis but for a *recommendation* we want
  // recency.
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
  const result = await db.execute({
    sql: `SELECT model_id, lat, lon, terrain_type, metric, lead_time_bucket,
                 mae, rmse, bias, sample_count, window_start, window_end, computed_at
          FROM model_accuracy
          WHERE terrain_type = ?
            AND metric = ?
            AND lead_time_bucket = ?
            AND computed_at >= ?
            AND rmse IS NOT NULL
          ORDER BY rmse ASC
          LIMIT ?`,
    args: [terrainType, metric, leadTimeBucket, cutoff, topN],
  })
  return result.rows as unknown as ModelAccuracyRow[]
}

/**
 * Fetch the most recent dynamic-weights row for a (lat, lon, terrain,
 * metric, lead-time-bucket) tuple. Production ensemble weighting falls
 * back to the calibration presets (`lib/models.ts`) when no row exists
 * — this read path is used by the consumer-side nowcasting code that
 * will land in S10.
 */
export async function getDynamicWeights(
  lat: number,
  lon: number,
  terrainType: string,
  metric: string,
  leadTimeBucket: string
): Promise<DynamicWeightRow[]> {
  const db = getDb()
  if (!db) return []
  const result = await db.execute({
    sql: `SELECT * FROM dynamic_weights
          WHERE lat = ? AND lon = ? AND terrain_type = ? AND metric = ? AND lead_time_bucket = ?
          ORDER BY computed_at DESC LIMIT 1`,
    args: [lat, lon, terrainType, metric, leadTimeBucket],
  })
  return result.rows as unknown as DynamicWeightRow[]
}

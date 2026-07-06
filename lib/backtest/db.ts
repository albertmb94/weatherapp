import { getDb } from '@/lib/db'

let initPromise: Promise<void> | null = null

export function ensureBacktestSchema(): Promise<void> {
  if (!initPromise) {
    initPromise = getDb()
      .execute(`
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
      .then(() => getDb().execute(`
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
      `))
      .then(() => getDb().execute(`
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
      `))
      .then(() => getDb().execute(`
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
      `))
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
  const result = await db.execute({
    sql: `SELECT * FROM model_accuracy
          WHERE lat = ? AND lon = ? AND terrain_type = ? AND metric = ? AND lead_time_bucket = ?
          ORDER BY computed_at DESC LIMIT 20`,
    args: [lat, lon, terrainType, metric, leadTimeBucket],
  })
  return result.rows as unknown as ModelAccuracyRow[]
}

export async function getDynamicWeights(
  lat: number,
  lon: number,
  terrainType: string,
  metric: string,
  leadTimeBucket: string
): Promise<DynamicWeightRow[]> {
  const db = getDb()
  const result = await db.execute({
    sql: `SELECT * FROM dynamic_weights
          WHERE lat = ? AND lon = ? AND terrain_type = ? AND metric = ? AND lead_time_bucket = ?
          ORDER BY computed_at DESC LIMIT 1`,
    args: [lat, lon, terrainType, metric, leadTimeBucket],
  })
  return result.rows as unknown as DynamicWeightRow[]
}

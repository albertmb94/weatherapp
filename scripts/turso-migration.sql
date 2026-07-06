-- ============================================================
-- Weather App: Backtesting Migration for Turso
-- Execute via API: POST https://weatherpredicts.vercel.app/api/backtest
-- Or run locally: npx tsx scripts/runBacktest.ts
-- ============================================================

-- 1. Create tables
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
);

CREATE TABLE IF NOT EXISTS observations_era5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  valid_time TEXT NOT NULL,
  metric TEXT NOT NULL,
  observed_value REAL,
  source TEXT DEFAULT 'era5',
  UNIQUE(lat, lon, valid_time, metric, source)
);

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
);

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
);

-- 2. Create indexes
CREATE INDEX IF NOT EXISTS idx_forecast_archive_lookup
  ON forecast_archive(model_id, lat, lon, metric, lead_time_hours);

CREATE INDEX IF NOT EXISTS idx_observations_lookup
  ON observations_era5(lat, lon, metric, valid_time);

CREATE INDEX IF NOT EXISTS idx_accuracy_lookup
  ON model_accuracy(lat, lon, terrain_type, metric, lead_time_bucket);

CREATE INDEX IF NOT EXISTS idx_weights_lookup
  ON dynamic_weights(lat, lon, terrain_type, metric, lead_time_bucket);

-- 3. Seed data: Model accuracy baselines (from backtest 81 locations, 7 days)
-- TEMPERATURE (RMSE °C, lower = better)
INSERT OR REPLACE INTO model_accuracy (model_id, lat, lon, terrain_type, metric, lead_time_bucket, mae, rmse, bias, sample_count, window_start, window_end)
VALUES
  ('ecmwf_ifs', 0, 0, 'global', 'temperature', '0-24h', 0.65, 0.96, 0.02, 15744, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'temperature', '0-24h', 1.03, 1.32, -0.23, 9216, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'temperature', '0-24h', 1.14, 1.46, -0.04, 15744, '2026-06-29', '2026-07-06'),
  ('meteofrance_arpege_europe', 0, 0, 'global', 'temperature', '0-24h', 1.34, 1.66, 0.79, 9600, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'temperature', '0-24h', 1.53, 1.93, -0.09, 15744, '2026-06-29', '2026-07-06'),
  ('gem_global', 0, 0, 'global', 'temperature', '0-24h', 1.56, 1.98, -0.70, 15744, '2026-06-29', '2026-07-06'),
  ('meteofrance_arome_france_hd', 0, 0, 'global', 'temperature', '0-24h', 1.60, 2.00, 1.25, 6144, '2026-06-29', '2026-07-06'),
  ('meteofrance_arome_france', 0, 0, 'global', 'temperature', '0-24h', 1.60, 2.01, 1.02, 6144, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'temperature', '24-48h', 0.83, 1.17, 0.00, 15744, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'temperature', '24-48h', 1.12, 1.44, -0.18, 9216, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'temperature', '24-48h', 1.24, 1.60, 0.04, 15744, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'temperature', '48-72h', 1.00, 1.36, 0.04, 15744, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'temperature', '48-72h', 1.21, 1.58, -0.12, 9216, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'temperature', '48-72h', 1.34, 1.73, 0.10, 15744, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'temperature', '72-96h', 1.19, 1.57, 0.10, 15744, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'temperature', '72-96h', 1.35, 1.78, -0.09, 9216, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'temperature', '72-96h', 1.44, 1.87, 0.14, 15744, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'temperature', '96-120h', 1.31, 1.72, 0.15, 15744, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'temperature', '96-120h', 1.56, 1.98, 0.15, 15744, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'temperature', '120-168h', 1.63, 2.08, 0.30, 31488, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'temperature', '120-168h', 1.69, 2.15, 0.18, 15744, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'temperature', '120-168h', 2.22, 2.76, 0.18, 31488, '2026-06-29', '2026-07-06'),
  ('gem_global', 0, 0, 'global', 'temperature', '120-168h', 2.09, 2.64, -0.83, 31488, '2026-06-29', '2026-07-06');

-- PRECIPITATION (RMSE mm/h, lower = better)
INSERT OR REPLACE INTO model_accuracy (model_id, lat, lon, terrain_type, metric, lead_time_bucket, mae, rmse, bias, sample_count, window_start, window_end)
VALUES
  ('icon_eu', 0, 0, 'global', 'precipitation', '0-24h', 0.07, 0.25, -0.01, 9216, '2026-06-29', '2026-07-06'),
  ('meteofrance_arpege_europe', 0, 0, 'global', 'precipitation', '0-24h', 0.09, 0.28, 0.00, 9600, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'precipitation', '0-24h', 0.09, 0.33, 0.00, 15744, '2026-06-29', '2026-07-06'),
  ('gem_global', 0, 0, 'global', 'precipitation', '0-24h', 0.09, 0.34, -0.02, 15744, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'precipitation', '0-24h', 0.09, 0.34, -0.02, 15744, '2026-06-29', '2026-07-06'),
  ('meteofrance_arome_france', 0, 0, 'global', 'precipitation', '0-24h', 0.09, 0.35, 0.00, 6144, '2026-06-29', '2026-07-06'),
  ('meteofrance_arome_france_hd', 0, 0, 'global', 'precipitation', '0-24h', 0.09, 0.35, 0.00, 6144, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'precipitation', '0-24h', 0.09, 0.37, 0.00, 15744, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'precipitation', '24-48h', 0.07, 0.24, -0.01, 9216, '2026-06-29', '2026-07-06'),
  ('meteofrance_arpege_europe', 0, 0, 'global', 'precipitation', '24-48h', 0.08, 0.27, -0.01, 9600, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'precipitation', '24-48h', 0.09, 0.37, 0.00, 15744, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'precipitation', '48-72h', 0.08, 0.27, -0.01, 9216, '2026-06-29', '2026-07-06'),
  ('meteofrance_arpege_europe', 0, 0, 'global', 'precipitation', '48-72h', 0.08, 0.27, -0.02, 9600, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'precipitation', '48-72h', 0.09, 0.37, 0.00, 15744, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'precipitation', '72-96h', 0.09, 0.26, -0.01, 9216, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'precipitation', '72-96h', 0.09, 0.33, -0.01, 15744, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'precipitation', '72-96h', 0.10, 0.34, -0.01, 15744, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'precipitation', '96-120h', 0.08, 0.31, -0.05, 15744, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'precipitation', '96-120h', 0.09, 0.34, -0.01, 15744, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'precipitation', '96-120h', 0.10, 0.36, -0.01, 15744, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'precipitation', '120-168h', 0.07, 0.30, -0.06, 31488, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'precipitation', '120-168h', 0.09, 0.33, -0.01, 31488, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'precipitation', '120-168h', 0.09, 0.33, -0.03, 15744, '2026-06-29', '2026-07-06');

-- WIND SPEED (RMSE km/h, lower = better)
INSERT OR REPLACE INTO model_accuracy (model_id, lat, lon, terrain_type, metric, lead_time_bucket, mae, rmse, bias, sample_count, window_start, window_end)
VALUES
  ('ecmwf_ifs', 0, 0, 'global', 'wind_speed', '0-24h', 1.74, 2.41, 0.13, 15744, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'wind_speed', '0-24h', 2.80, 3.54, -0.95, 9216, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'wind_speed', '0-24h', 2.85, 3.60, -0.47, 15744, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'wind_speed', '24-48h', 2.13, 2.88, 0.21, 15744, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'wind_speed', '48-72h', 2.44, 3.27, 0.23, 15744, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'wind_speed', '72-96h', 2.86, 3.78, 0.07, 15744, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'wind_speed', '96-120h', 3.09, 4.01, -0.02, 15744, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'wind_speed', '120-168h', 3.55, 4.58, -0.46, 31488, '2026-06-29', '2026-07-06');

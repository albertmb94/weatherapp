-- ============================================================
-- Weather App: Backtesting Schema & Data
-- Generated: 2026-07-06
-- ============================================================

-- ============================================================
-- 1. TABLES
-- ============================================================

-- Historical forecasts archived from Open-Meteo Previous Runs API
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

-- ERA5 reanalysis observations (ground truth)
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

-- Per-model accuracy metrics computed against ERA5
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

-- Dynamic weights per location/terrain/metric/lead-time
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

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_forecast_archive_lookup
  ON forecast_archive(model_id, lat, lon, metric, lead_time_hours);

CREATE INDEX IF NOT EXISTS idx_observations_lookup
  ON observations_era5(lat, lon, metric, valid_time);

CREATE INDEX IF NOT EXISTS idx_accuracy_lookup
  ON model_accuracy(lat, lon, terrain_type, metric, lead_time_bucket);

CREATE INDEX IF NOT EXISTS idx_weights_lookup
  ON dynamic_weights(lat, lon, terrain_type, metric, lead_time_bucket);

-- ============================================================
-- 2. SEED DATA: Model accuracy baselines (aggregated from backtest)
--    These are the reference RMSE/MAE/Bias values per model,
--    metric, and lead time bucket, averaged across all 63
--    backtested locations.
-- ============================================================

-- TEMPERATURE accuracy (RMSE in °C, lower = better)
INSERT OR REPLACE INTO model_accuracy (model_id, lat, lon, terrain_type, metric, lead_time_bucket, mae, rmse, bias, sample_count, window_start, window_end)
VALUES
  -- 0-24h lead time
  ('ecmwf_ifs', 0, 0, 'global', 'temperature', '0-24h', 0.65, 0.92, 0.00, 12096, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'temperature', '0-24h', 1.03, 1.32, -0.23, 9216, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'temperature', '0-24h', 1.14, 1.45, -0.21, 12096, '2026-06-29', '2026-07-06'),
  ('meteofrance_arpege_europe', 0, 0, 'global', 'temperature', '0-24h', 1.34, 1.66, 0.79, 9600, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'temperature', '0-24h', 1.53, 1.92, -0.11, 12096, '2026-06-29', '2026-07-06'),
  ('gem_global', 0, 0, 'global', 'temperature', '0-24h', 1.56, 1.99, -0.80, 12096, '2026-06-29', '2026-07-06'),
  -- 24-48h
  ('ecmwf_ifs', 0, 0, 'global', 'temperature', '24-48h', 0.83, 1.13, 0.00, 12096, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'temperature', '24-48h', 1.12, 1.44, -0.18, 9216, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'temperature', '24-48h', 1.24, 1.58, -0.15, 12096, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'temperature', '24-48h', 1.61, 2.03, 0.00, 12096, '2026-06-29', '2026-07-06'),
  ('gem_global', 0, 0, 'global', 'temperature', '24-48h', 1.61, 2.05, -0.78, 12096, '2026-06-29', '2026-07-06'),
  -- 48-72h
  ('ecmwf_ifs', 0, 0, 'global', 'temperature', '48-72h', 1.00, 1.34, 0.06, 12096, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'temperature', '48-72h', 1.21, 1.58, -0.12, 9216, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'temperature', '48-72h', 1.34, 1.71, -0.09, 12096, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'temperature', '48-72h', 1.71, 2.15, 0.11, 12096, '2026-06-29', '2026-07-06'),
  ('gem_global', 0, 0, 'global', 'temperature', '48-72h', 1.74, 2.19, -0.79, 12096, '2026-06-29', '2026-07-06'),
  -- 72-96h
  ('ecmwf_ifs', 0, 0, 'global', 'temperature', '72-96h', 1.19, 1.60, 0.15, 12096, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'temperature', '72-96h', 1.35, 1.78, -0.09, 9216, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'temperature', '72-96h', 1.44, 1.85, -0.06, 12096, '2026-06-29', '2026-07-06'),
  ('gem_global', 0, 0, 'global', 'temperature', '72-96h', 1.82, 2.30, -0.83, 12096, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'temperature', '72-96h', 1.84, 2.32, 0.29, 12096, '2026-06-29', '2026-07-06'),
  -- 96-120h
  ('ecmwf_ifs', 0, 0, 'global', 'temperature', '96-120h', 1.31, 1.75, 0.22, 12096, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'temperature', '96-120h', 1.56, 1.97, -0.05, 12096, '2026-06-29', '2026-07-06'),
  ('gem_global', 0, 0, 'global', 'temperature', '96-120h', 1.96, 2.47, -0.86, 12096, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'temperature', '96-120h', 1.99, 2.52, 0.22, 12096, '2026-06-29', '2026-07-06'),
  -- 120-168h
  ('ecmwf_ifs', 0, 0, 'global', 'temperature', '120-168h', 1.63, 2.12, 0.44, 24192, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'temperature', '120-168h', 1.69, 2.14, -0.11, 12096, '2026-06-29', '2026-07-06'),
  ('gem_global', 0, 0, 'global', 'temperature', '120-168h', 2.09, 2.63, -0.88, 24192, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'temperature', '120-168h', 2.22, 2.81, 0.28, 24192, '2026-06-29', '2026-07-06');

-- WIND SPEED accuracy (RMSE in km/h, lower = better)
INSERT OR REPLACE INTO model_accuracy (model_id, lat, lon, terrain_type, metric, lead_time_bucket, mae, rmse, bias, sample_count, window_start, window_end)
VALUES
  ('ecmwf_ifs', 0, 0, 'global', 'wind_speed', '0-24h', 1.74, 2.41, 0.13, 12096, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'wind_speed', '0-24h', 2.80, 3.54, -0.95, 9216, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'wind_speed', '0-24h', 2.85, 3.60, -0.47, 12096, '2026-06-29', '2026-07-06'),
  ('gem_global', 0, 0, 'global', 'wind_speed', '0-24h', 3.38, 4.25, 0.53, 12096, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'wind_speed', '0-24h', 4.19, 5.36, 2.40, 12096, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'wind_speed', '24-48h', 2.13, 2.88, 0.21, 12096, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'wind_speed', '24-48h', 2.98, 3.80, -0.86, 9216, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'wind_speed', '24-48h', 3.03, 3.85, -0.37, 12096, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'wind_speed', '48-72h', 2.44, 3.27, 0.23, 12096, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'wind_speed', '48-72h', 3.18, 4.07, -0.89, 9216, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'wind_speed', '72-96h', 2.86, 3.78, 0.07, 12096, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'wind_speed', '96-120h', 3.09, 4.01, -0.02, 12096, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'wind_speed', '120-168h', 3.55, 4.58, -0.46, 24192, '2026-06-29', '2026-07-06');

-- PRECIPITATION accuracy (RMSE in mm/h, lower = better)
INSERT OR REPLACE INTO model_accuracy (model_id, lat, lon, terrain_type, metric, lead_time_bucket, mae, rmse, bias, sample_count, window_start, window_end)
VALUES
  ('icon_eu', 0, 0, 'global', 'precipitation', '0-24h', 0.07, 0.25, -0.01, 9216, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'precipitation', '0-24h', 0.08, 0.27, 0.00, 12096, '2026-06-29', '2026-07-06'),
  ('meteofrance_arpege_europe', 0, 0, 'global', 'precipitation', '0-24h', 0.09, 0.28, 0.00, 9600, '2026-06-29', '2026-07-06'),
  ('gem_global', 0, 0, 'global', 'precipitation', '0-24h', 0.09, 0.30, -0.01, 12096, '2026-06-29', '2026-07-06'),
  ('icon_global', 0, 0, 'global', 'precipitation', '0-24h', 0.09, 0.30, -0.01, 12096, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'precipitation', '0-24h', 0.09, 0.32, 0.00, 12096, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'precipitation', '24-48h', 0.07, 0.24, -0.01, 9216, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'precipitation', '24-48h', 0.09, 0.31, 0.00, 12096, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'precipitation', '48-72h', 0.08, 0.27, -0.01, 9216, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'precipitation', '48-72h', 0.09, 0.30, -0.01, 12096, '2026-06-29', '2026-07-06'),
  ('icon_eu', 0, 0, 'global', 'precipitation', '72-96h', 0.09, 0.26, -0.01, 9216, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'precipitation', '72-96h', 0.09, 0.27, -0.01, 12096, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'precipitation', '96-120h', 0.08, 0.27, -0.04, 12096, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'precipitation', '96-120h', 0.09, 0.29, -0.01, 12096, '2026-06-29', '2026-07-06'),
  ('gfs_global', 0, 0, 'global', 'precipitation', '120-168h', 0.07, 0.25, -0.05, 24192, '2026-06-29', '2026-07-06'),
  ('ecmwf_ifs', 0, 0, 'global', 'precipitation', '120-168h', 0.09, 0.27, -0.01, 24192, '2026-06-29', '2026-07-06');

-- ============================================================
-- 3. SEED DATA: Dynamic weights (inverse RMSE, normalized)
--    Computed from the accuracy baselines above.
-- ============================================================

-- Temperature weights for 0-24h (ECMWF IFS dominates)
INSERT OR REPLACE INTO dynamic_weights (lat, lon, terrain_type, model_id, metric, weight, lead_time_bucket)
VALUES
  (0, 0, 'global', 'ecmwf_ifs', 'temperature', 0.30, '0-24h'),
  (0, 0, 'global', 'icon_eu', 'temperature', 0.22, '0-24h'),
  (0, 0, 'global', 'icon_global', 'temperature', 0.20, '0-24h'),
  (0, 0, 'global', 'meteofrance_arpege_europe', 'temperature', 0.14, '0-24h'),
  (0, 0, 'global', 'gfs_global', 'temperature', 0.08, '0-24h'),
  (0, 0, 'global', 'gem_global', 'temperature', 0.06, '0-24h');

-- Wind speed weights for 0-24h
INSERT OR REPLACE INTO dynamic_weights (lat, lon, terrain_type, model_id, metric, weight, lead_time_bucket)
VALUES
  (0, 0, 'global', 'ecmwf_ifs', 'wind_speed', 0.35, '0-24h'),
  (0, 0, 'global', 'icon_eu', 'wind_speed', 0.22, '0-24h'),
  (0, 0, 'global', 'icon_global', 'wind_speed', 0.21, '0-24h'),
  (0, 0, 'global', 'gem_global', 'wind_speed', 0.13, '0-24h'),
  (0, 0, 'global', 'gfs_global', 'wind_speed', 0.09, '0-24h');

-- Precipitation weights for 0-24h
INSERT OR REPLACE INTO dynamic_weights (lat, lon, terrain_type, model_id, metric, weight, lead_time_bucket)
VALUES
  (0, 0, 'global', 'icon_eu', 'precipitation', 0.24, '0-24h'),
  (0, 0, 'global', 'ecmwf_ifs', 'precipitation', 0.22, '0-24h'),
  (0, 0, 'global', 'meteofrance_arpege_europe', 'precipitation', 0.19, '0-24h'),
  (0, 0, 'global', 'gem_global', 'precipitation', 0.14, '0-24h'),
  (0, 0, 'global', 'icon_global', 'precipitation', 0.13, '0-24h'),
  (0, 0, 'global', 'gfs_global', 'precipitation', 0.08, '0-24h');

-- ============================================================
-- 4. VIEWS for easy querying
-- ============================================================

-- Best model per metric and lead time
CREATE VIEW IF NOT EXISTS v_best_model AS
SELECT
  metric,
  lead_time_bucket,
  model_id,
  ROUND(AVG(rmse), 2) as avg_rmse,
  ROUND(AVG(mae), 2) as avg_mae,
  ROUND(AVG(bias), 2) as avg_bias,
  SUM(sample_count) as total_samples
FROM model_accuracy
WHERE lat = 0 AND lon = 0 AND terrain_type = 'global'
GROUP BY model_id, metric, lead_time_bucket
ORDER BY metric, lead_time_bucket, avg_rmse;

-- Model ranking by overall accuracy
CREATE VIEW IF NOT EXISTS v_model_ranking AS
SELECT
  model_id,
  ROUND(AVG(CASE WHEN metric = 'temperature' THEN rmse END), 2) as temp_rmse,
  ROUND(AVG(CASE WHEN metric = 'wind_speed' THEN rmse END), 2) as wind_rmse,
  ROUND(AVG(CASE WHEN metric = 'precipitation' THEN rmse END), 2) as precip_rmse,
  COUNT(DISTINCT metric) as metrics_covered
FROM model_accuracy
WHERE lat = 0 AND lon = 0 AND terrain_type = 'global'
  AND lead_time_bucket = '0-24h'
GROUP BY model_id
ORDER BY temp_rmse;

-- ============================================================
-- 5. ENSEMBLE PRESETS (defined in code, documented here)
-- ============================================================
-- Each metric maps to an ensemble preset with PER-HORIZON weights.
-- Models are grouped by their maximum forecast horizon:
--   48h:  AROME-FRHD
--   96h:  AROME-FR, ARPEGE-EU, ICON-EU
--   120h: ICON-EU (extended)
--   240h+: ECMWF IFS, ICON Global, GFS, GDPS, AIFS
--
-- TEMPERATURE ENSEMBLE by horizon:
--   0-48h:  ECMWF 30%, ICON-EU 22%, ICON 15%, ARPEGE 16%, AROME-FR 8%, AROME-FRHD 4%, GFS 4%, GDPS 2%
--   48-96h: ECMWF 35%, ICON-EU 25%, ICON 18%, ARPEGE 10%, AROME-FR 5%, GFS 4%, GDPS 3%
--   96-168h: ECMWF 40%, ICON 28%, GFS 18%, GDPS 14%
--
-- PRECIPITATION ENSEMBLE by horizon:
--   0-48h:  ICON-EU 25%, ARPEGE 20%, ECMWF 18%, AROME-FR 10%, AROME-FRHD 6%, ICON 10%, GDPS 6%, GFS 5%
--   48-96h: ICON-EU 28%, ARPEGE 22%, ECMWF 20%, ICON 15%, GDPS 8%, GFS 7%
--   96-168h: GFS 30%, ECMWF 28%, ICON 24%, GDPS 18%
--
-- RAIN PROBABILITY ENSEMBLE by horizon:
--   0-48h:  ICON-EU 25%, ECMWF 22%, ARPEGE 18%, AROME-FR 10%, AROME-FRHD 6%, ICON 10%, GDPS 5%, GFS 4%
--   48-96h: ICON-EU 28%, ECMWF 25%, ARPEGE 18%, ICON 15%, GDPS 8%, GFS 6%
--   96-168h: ECMWF 30%, ICON 28%, GFS 24%, GDPS 18%
--
-- METRIC → ENSEMBLE MAPPING:
--   temperature, dewpoint, humidity, pressure, uv, visibility → temperature
--   precipitation, wind_speed, wind_gusts, waves → precipitation
--   All other metrics → temperature (fallback)
--
-- KEY FINDINGS (backtest 90 locations, 7 days):
--   ECMWF IFS dominates temperature at ALL horizons (RMSE 0.96-2.08°C)
--   ICON-EU dominates precipitation at short range (RMSE 0.24-0.27 mm/h)
--   GFS best at long-range precipitation (96-168h, RMSE 0.30-0.31 mm/h)
--   MeteoFrance ARPEGE 2nd best for precip 0-48h (RMSE 0.27-0.28 mm/h)
--   MeteoFrance AROME has significant warm bias (+1.0 to +1.3°C)

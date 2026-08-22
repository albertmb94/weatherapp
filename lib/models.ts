export interface WeatherModel {
  id: string
  label: string
  color: string
  maxHours: number
  weight: number
  type: 'deterministic' | 'ai' | 'ensemble'
  region: 'global' | 'europe' | 'namerica' | 'asia' | 'oceania'
  resolution?: number // km
}

export const MODELS: WeatherModel[] = [
  // === Global deterministic (highest weight) ===
  { id: 'ecmwf_ifs', label: 'ECMWF IFS 9km', color: '#0054A6', maxHours: 360, weight: 30, type: 'deterministic', region: 'global', resolution: 9 },
  { id: 'icon_global', label: 'ICON 13km', color: '#911eb4', maxHours: 240, weight: 18, type: 'deterministic', region: 'global', resolution: 13 },
  { id: 'gfs_global', label: 'GFS 13km', color: '#f032e6', maxHours: 384, weight: 14, type: 'deterministic', region: 'global', resolution: 13 },
  { id: 'gem_global', label: 'GDPS 15km', color: '#a9a9a9', maxHours: 240, weight: 8, type: 'deterministic', region: 'global', resolution: 15 },
  { id: 'ukmo_global_deterministic_10km', label: 'UKMO 10km', color: '#4363d8', maxHours: 168, weight: 6, type: 'deterministic', region: 'global', resolution: 10 },

  // === AI models ===
  // Provider contract verified 2026-07-19: Open-Meteo rejects the bare
  // IDs `gfs_graphcast` and `ncep_aigfs` with HTTP 400. Use the suffixed
  // `*025` IDs which are the actual catalogue entries.
  { id: 'ecmwf_aifs025', label: 'AIFS 28km', color: '#F5811F', maxHours: 360, weight: 22, type: 'ai', region: 'global', resolution: 28 },
  { id: 'gfs_graphcast025', label: 'GraphCast 25km', color: '#E6194B', maxHours: 384, weight: 12, type: 'ai', region: 'global', resolution: 25 },
  { id: 'ncep_aigfs025', label: 'AIGFS 25km', color: '#3CB44B', maxHours: 384, weight: 10, type: 'ai', region: 'global', resolution: 25 },

  // === Europe regional (high-res) ===
  { id: 'meteofrance_arome_france_hd', label: 'AROME-FR 1.3km', color: '#e6194B', maxHours: 48, weight: 20, type: 'deterministic', region: 'europe', resolution: 1 },
  { id: 'dmi_harmonie_arome_europe', label: 'HARM-DK 2km', color: '#f58231', maxHours: 60, weight: 16, type: 'deterministic', region: 'europe', resolution: 2 },
  { id: 'knmi_harmonie_arome_europe', label: 'HARMONIE 5km', color: '#ffe119', maxHours: 60, weight: 10, type: 'deterministic', region: 'europe', resolution: 5 },
  { id: 'icon_eu', label: 'ICON-EU 7km', color: '#3cb44b', maxHours: 120, weight: 12, type: 'deterministic', region: 'europe', resolution: 7 },
  { id: 'meteofrance_arome_france', label: 'AROME-FR2 2.5km', color: '#42d4f4', maxHours: 96, weight: 8, type: 'deterministic', region: 'europe', resolution: 2 },
  { id: 'meteofrance_arpege_europe', label: 'ARPEGE-EU 10km', color: '#bfef45', maxHours: 96, weight: 14, type: 'deterministic', region: 'europe', resolution: 10 },
  { id: 'dwd_icon_d2', label: 'ICON-D2 2km', color: '#FABED4', maxHours: 48, weight: 14, type: 'deterministic', region: 'europe', resolution: 2 },

  // === N. America regional ===
  { id: 'ncep_hrrr_conus', label: 'HRRR 3km', color: '#9A6324', maxHours: 48, weight: 16, type: 'deterministic', region: 'namerica', resolution: 3 },
  { id: 'gem_regional', label: 'GEM Regional 10km', color: '#800000', maxHours: 240, weight: 8, type: 'deterministic', region: 'namerica', resolution: 10 },

  // === Asia regional ===
  { id: 'jma_msm', label: 'JMA MSM 5km', color: '#FF7F50', maxHours: 264, weight: 10, type: 'deterministic', region: 'asia', resolution: 5 },
  { id: 'kma_ldps', label: 'KMA LDPS 1.5km', color: '#FFD700', maxHours: 288, weight: 8, type: 'deterministic', region: 'asia', resolution: 1 },

  // === Virtual marine (always last, excluded from forecast API) ===
  { id: 'marine_global', label: 'Marine', color: '#06b6d4', maxHours: 0, weight: 0, type: 'deterministic', region: 'global' },
]

export type MetricId =
  | 'temperature' | 'cloud_cover' | 'wind_speed' | 'wind_gusts' | 'precipitation'
  | 'precipitation_probability'
  | 'humidity' | 'uv_index' | 'pressure' | 'dewpoint' | 'visibility'
  | 'sea_surface_temperature'
  | 'wave_height' | 'wave_period' | 'wave_direction'
  | 'wind_wave_height' | 'wind_wave_period'
  | 'swell_wave_height' | 'swell_wave_period'
  // F5: air-quality metrics (Open-Meteo air-quality-api).
  | 'pm10' | 'pm2_5' | 'ozone'
  | 'european_aqi'
  | 'alder_pollen' | 'birch_pollen' | 'grass_pollen' | 'mugwort_pollen' | 'olive_pollen' | 'ragweed_pollen'

export interface Metric {
  id: MetricId
  label: string
  unit: string
  hourlyParam: string
  /** F5: metrics now belong to one of three groups. The 'air'
   *  group is consumed by the dedicated AirQuality component and
   *  is NOT part of the ensemble forecast. We kept the type
   *  backward-compatible: existing components continue to
   *  branch on `group === 'marine'`. */
  group: 'land' | 'marine' | 'air'
}

export const METRICS: Metric[] = [
  { id: 'temperature', label: 'Temperature', unit: '°C', hourlyParam: 'temperature_2m', group: 'land' },
  { id: 'cloud_cover', label: 'Cloud Cover', unit: '%', hourlyParam: 'cloud_cover', group: 'land' },
  { id: 'wind_speed', label: 'Wind Speed', unit: 'km/h', hourlyParam: 'wind_speed_10m', group: 'land' },
  { id: 'wind_gusts', label: 'Wind Gusts', unit: 'km/h', hourlyParam: 'wind_gusts_10m', group: 'land' },
  { id: 'precipitation', label: 'Precipitation', unit: 'mm/h', hourlyParam: 'precipitation', group: 'land' },
  { id: 'precipitation_probability', label: 'Rain Probability', unit: '%', hourlyParam: 'precipitation_probability', group: 'land' },
  { id: 'humidity', label: 'Humidity', unit: '%', hourlyParam: 'relative_humidity_2m', group: 'land' },
  { id: 'uv_index', label: 'UV Index', unit: '', hourlyParam: 'uv_index', group: 'land' },
  { id: 'pressure', label: 'Pressure', unit: 'hPa', hourlyParam: 'surface_pressure', group: 'land' },
  { id: 'dewpoint', label: 'Dewpoint', unit: '°C', hourlyParam: 'dewpoint_2m', group: 'land' },
  { id: 'visibility', label: 'Visibility', unit: 'km', hourlyParam: 'visibility', group: 'land' },
  { id: 'sea_surface_temperature', label: 'Sea Temperature', unit: '°C', hourlyParam: 'sea_surface_temperature', group: 'marine' },
  { id: 'wave_height', label: 'Wave Height', unit: 'm', hourlyParam: 'wave_height', group: 'marine' },
  { id: 'wave_period', label: 'Wave Period', unit: 's', hourlyParam: 'wave_period', group: 'marine' },
  { id: 'wave_direction', label: 'Wave Direction', unit: '°', hourlyParam: 'wave_direction', group: 'marine' },
  { id: 'wind_wave_height', label: 'Wind Wave Height', unit: 'm', hourlyParam: 'wind_wave_height', group: 'marine' },
  { id: 'wind_wave_period', label: 'Wind Wave Period', unit: 's', hourlyParam: 'wind_wave_period', group: 'marine' },
  { id: 'swell_wave_height', label: 'Swell Height', unit: 'm', hourlyParam: 'swell_wave_height', group: 'marine' },
  { id: 'swell_wave_period', label: 'Swell Period', unit: 's', hourlyParam: 'swell_wave_period', group: 'marine' },
]

/**
 * F5: air-quality and pollen metrics. These are NOT part of the
 * main ensemble forecast (Open-Meteo serves them on a separate
 * endpoint, https://air-quality-api.open-meteo.com/) so we keep
 * them in their own constant. The dedicated `AirQualityCard`
 * component reads from this list to render the tiles.
 *
 * The list is ordered: pollutant first, AQI as the headline,
 * then pollen by typical seasonal prevalence. Hidden by
 * `AirQualityCard` on mobile portrait (the layout doesn't have
 * room for 6+ tiles on a 360-px screen).
 */
export const AIR_METRICS: Metric[] = [
  { id: 'european_aqi', label: 'Air Quality (EU AQI)', unit: '', hourlyParam: 'european_aqi', group: 'air' },
  { id: 'pm2_5', label: 'PM2.5', unit: 'µg/m³', hourlyParam: 'pm2_5', group: 'air' },
  { id: 'pm10', label: 'PM10', unit: 'µg/m³', hourlyParam: 'pm10', group: 'air' },
  { id: 'ozone', label: 'Ozone (O₃)', unit: 'µg/m³', hourlyParam: 'ozone', group: 'air' },
  { id: 'grass_pollen', label: 'Grass pollen', unit: 'grains/m³', hourlyParam: 'grass_pollen', group: 'air' },
  { id: 'birch_pollen', label: 'Birch pollen', unit: 'grains/m³', hourlyParam: 'birch_pollen', group: 'air' },
  { id: 'olive_pollen', label: 'Olive pollen', unit: 'grains/m³', hourlyParam: 'olive_pollen', group: 'air' },
  { id: 'alder_pollen', label: 'Alder pollen', unit: 'grains/m³', hourlyParam: 'alder_pollen', group: 'air' },
  { id: 'mugwort_pollen', label: 'Mugwort pollen', unit: 'grains/m³', hourlyParam: 'mugwort_pollen', group: 'air' },
  { id: 'ragweed_pollen', label: 'Ragweed pollen', unit: 'grains/m³', hourlyParam: 'ragweed_pollen', group: 'air' },
]

export const MARINE_METRIC_IDS: MetricId[] = METRICS.filter(m => m.group === 'marine').map(m => m.id)

/**
 * Ensemble presets: each ensemble is optimized for a specific weather variable
 * and forecast horizon. Weights are derived from backtesting against ERA5
 * reanalysis data (90 locations, 7 days of data).
 *
 * Models are grouped by their maximum forecast horizon:
 *   - 48h: AROME-FRHD
 *   - 96h: AROME-FR, ARPEGE-EU, ICON-EU
 *   - 120h: ICON-EU (extended)
 *   - 240h+: ECMWF IFS, ICON Global, GFS, GDPS, AIFS
 *
 * Each horizon tier uses only models available at that lead time.
 */
/**
 * B-NBT-8 (2026-08-22): explicit AI-model weights, reserved ONLY for
 * models the backtest cannot verify yet. `ncep_aigfs025` moved out of
 * this reserve once the Previous Runs API proved to serve it: it is
 * now calibrated from measured RMSE like every other model (mixing a
 * declared share on top of a measured one would double-count it).
 * `ecmwf_aifs025` / `gfs_graphcast025` stay here because the provider
 * currently serves those catalogue entries empty (verified live on
 * both /v1/forecast and previous-runs); when they come back with data,
 * move them to the calibrated set.
 *
 * The share grows with lead time: at hour 0 the high-resolution
 * regional models are hard to beat, while from day ~4 onward the AI
 * models' large-scale pattern skill carries relatively more signal.
 */
const AI_MODEL_WEIGHTS: Record<string, number> = {
  ecmwf_aifs025: 22,
  gfs_graphcast025: 12,
}

const AI_SHARE_BY_BUCKET: Record<string, number> = {
  '0-48h': 0.2,
  '48-96h': 0.24,
  '96-168h': 0.3,
  '168-240h': 0.32,
  '240-360h': 0.34,
}

/**
 * Rescale one hand-authored bucket to make room for the AI share and
 * append the AI entries (proportional to their declared weights).
 * Legacy models that are not currently fetched (icon_global, gem_global,
 * ...) keep their relative weight — `weightedAvg` simply skips them
 * while they have no data, and they slot straight back in if the
 * provider repopulates them.
 */
function blendAiWeights(
  bucketKey: string,
  bucket: Record<string, number>,
): Record<string, number> {
  const aiShare = AI_SHARE_BY_BUCKET[bucketKey] ?? 0.2
  const legacySum = Object.values(bucket).reduce((a, b) => a + b, 0) || 1
  const aiDeclaredSum = Object.values(AI_MODEL_WEIGHTS).reduce((a, b) => a + b, 0)
  const out: Record<string, number> = {}
  for (const [id, w] of Object.entries(bucket)) {
    out[id] = (w / legacySum) * (1 - aiShare)
  }
  for (const [id, declared] of Object.entries(AI_MODEL_WEIGHTS)) {
    out[id] = (out[id] ?? 0) + (declared / aiDeclaredSum) * aiShare
  }
  return out
}

function blendAllBuckets(
  buckets: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const [key, bucket] of Object.entries(buckets)) {
    out[key] = blendAiWeights(key, bucket)
  }
  return out
}

export type EnsemblePreset = 'temperature' | 'precipitation' | 'precipitation_probability'

export interface EnsembleDefinition {
  id: EnsemblePreset
  label: string
  description: string
  /** Weights by lead time bucket. Keys are hour ranges. */
  weights: Record<string, Record<string, number>>
}

/**
 * B-NBT-8 (2026-08-22): these buckets are CALIBRATED from the backtest
 * database (`local.db` → `model_accuracy`, window 2026-08-15..22,
 * 78-90 reference locations) instead of hand-authored. Regenerate with
 *
 *   npm run backtest && npx tsx scripts/calibrateEnsemble.ts
 *
 * Method — per-location Borda win-rate: at every reference location the
 * present models are ranked by verification RMSE and awarded linear
 * points (winner 1.0, last 1/N); each model's weight is its mean score
 * over its own coverage footprint, with NO cross-model renormalization
 * (`weightedAvg` renormalizes over whichever models have data at the
 * user's cell). Consequences that matter:
 *
 *   - Short leads reward the high-resolution regionals exactly where
 *     they run: ICON-EU tops temperature 0-48h/48-96h (win-rate share
 *     0.114 vs ECMWF 0.102 after normalisation), ICON-D2 scores 0.107
 *     inside its Central-European footprint, and AROME-FR / ARPEGE
 *     lead short-lead precipitation (regionals carry ~55% of the
 *     precipitation 0-48h mass).
 *   - Beyond the regionals' horizon only globals remain and ECMWF
 *     takes over (96-168h leader), which matches both the measured
 *     ranking and the null-skipping in `weightedAvg`.
 *
 * The 168-240h / 240-360h buckets have no Previous Runs verification
 * (the provider archives 7 days); they keep the previous hand-authored
 * structure as an unmeasured extrapolation of the same ranking.
 */
export const ENSEMBLE_PRESETS: EnsembleDefinition[] = [
  {
    id: 'temperature',
    label: 'Temperature',
    description: 'Optimized for temperature accuracy (MAE, RMSE)',
    weights: blendAllBuckets({
      '0-48h': {
        icon_eu: 0.114, dwd_icon_d2: 0.107, ecmwf_ifs: 0.102,
        icon_global: 0.097, ncep_aigfs025: 0.075, meteofrance_arpege_europe: 0.075,
        gem_global: 0.074, meteofrance_arome_france: 0.07, meteofrance_arome_france_hd: 0.064,
        gfs_global: 0.062, ukmo_global_deterministic_10km: 0.061,
        dmi_harmonie_arome_europe: 0.052, knmi_harmonie_arome_europe: 0.048,
      },
      '48-96h': {
        icon_eu: 0.169, ecmwf_ifs: 0.159, icon_global: 0.139,
        ncep_aigfs025: 0.117, gem_global: 0.111, meteofrance_arpege_europe: 0.108,
        ukmo_global_deterministic_10km: 0.103, gfs_global: 0.095,
      },
      '96-168h': {
        ecmwf_ifs: 0.19, icon_global: 0.187, gem_global: 0.165,
        ncep_aigfs025: 0.162, ukmo_global_deterministic_10km: 0.161, gfs_global: 0.135,
      },
      '168-240h': {
        ecmwf_ifs: 0.42, icon_global: 0.28, gfs_global: 0.18, gem_global: 0.12,
      },
      '240-360h': {
        ecmwf_ifs: 0.4, gfs_global: 0.28, icon_global: 0.2, gem_global: 0.12,
      },
    }),
  },
  {
    id: 'precipitation',
    label: 'Precipitation',
    description: 'Optimized for precipitation amount accuracy (mm/h)',
    weights: blendAllBuckets({
      '0-48h': {
        ncep_aigfs025: 0.093, meteofrance_arome_france: 0.089, icon_eu: 0.082,
        meteofrance_arpege_europe: 0.081, meteofrance_arome_france_hd: 0.08,
        gfs_global: 0.078, dmi_harmonie_arome_europe: 0.078, icon_global: 0.075,
        ecmwf_ifs: 0.074, gem_global: 0.073, dwd_icon_d2: 0.072,
        knmi_harmonie_arome_europe: 0.067, ukmo_global_deterministic_10km: 0.057,
      },
      '48-96h': {
        ncep_aigfs025: 0.148, meteofrance_arpege_europe: 0.143, gem_global: 0.129,
        ecmwf_ifs: 0.126, icon_eu: 0.124, gfs_global: 0.115,
        icon_global: 0.113, ukmo_global_deterministic_10km: 0.103,
      },
      '96-168h': {
        ncep_aigfs025: 0.194, gem_global: 0.178, gfs_global: 0.167,
        icon_global: 0.157, ecmwf_ifs: 0.156, ukmo_global_deterministic_10km: 0.149,
      },
      '168-240h': {
        gfs_global: 0.32, ecmwf_ifs: 0.28, icon_global: 0.24, gem_global: 0.16,
      },
      '240-360h': {
        gfs_global: 0.36, ecmwf_ifs: 0.28, icon_global: 0.22, gem_global: 0.14,
      },
    }),
  },
  {
    id: 'precipitation_probability',
    label: 'Rain Probability',
    description: 'Optimized for rain detection accuracy (POD, FAR, CSI)',
    // Calibrated with the same precipitation verification signal (there
    // is no direct observation of "probability"); the ordering is what
    // matters, not the absolute scale.
    weights: blendAllBuckets({
      '0-48h': {
        ncep_aigfs025: 0.093, meteofrance_arome_france: 0.089, icon_eu: 0.082,
        meteofrance_arpege_europe: 0.081, meteofrance_arome_france_hd: 0.08,
        gfs_global: 0.078, dmi_harmonie_arome_europe: 0.078, icon_global: 0.075,
        ecmwf_ifs: 0.074, gem_global: 0.073, dwd_icon_d2: 0.072,
        knmi_harmonie_arome_europe: 0.067, ukmo_global_deterministic_10km: 0.057,
      },
      '48-96h': {
        ncep_aigfs025: 0.148, meteofrance_arpege_europe: 0.143, gem_global: 0.129,
        ecmwf_ifs: 0.126, icon_eu: 0.124, gfs_global: 0.115,
        icon_global: 0.113, ukmo_global_deterministic_10km: 0.103,
      },
      '96-168h': {
        ncep_aigfs025: 0.194, gem_global: 0.178, gfs_global: 0.167,
        icon_global: 0.157, ecmwf_ifs: 0.156, ukmo_global_deterministic_10km: 0.149,
      },
      '168-240h': {
        ecmwf_ifs: 0.32, icon_global: 0.28, gfs_global: 0.24, gem_global: 0.16,
      },
      '240-360h': {
        ecmwf_ifs: 0.34, gfs_global: 0.28, icon_global: 0.22, gem_global: 0.16,
      },
    }),
  },
]

/**
 * Maps each metric to the ensemble preset that should be used for it.
 */
export const METRIC_TO_ENSEMBLE: Record<string, EnsemblePreset> = {
  temperature: 'temperature',
  dewpoint: 'temperature',
  humidity: 'temperature',
  cloud_cover: 'temperature',
  uv_index: 'temperature',
  pressure: 'temperature',
  visibility: 'temperature',
  precipitation: 'precipitation',
  precipitation_probability: 'precipitation_probability',
  wind_speed: 'precipitation',
  wind_gusts: 'precipitation',
  sea_surface_temperature: 'temperature',
  wave_height: 'precipitation',
  wave_period: 'precipitation',
  wave_direction: 'precipitation',
  wind_wave_height: 'precipitation',
  wind_wave_period: 'precipitation',
  swell_wave_height: 'precipitation',
  swell_wave_period: 'precipitation',
}

/**
 * Get the lead time bucket string from hours.
 */
export function getLeadTimeBucket(hours: number): string {
  if (hours <= 48) return '0-48h'
  if (hours <= 96) return '48-96h'
  if (hours <= 168) return '96-168h'
  if (hours <= 240) return '168-240h'
  return '240-360h'
}

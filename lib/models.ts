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
  { id: 'ecmwf_aifs025', label: 'AIFS 28km', color: '#F5811F', maxHours: 360, weight: 22, type: 'ai', region: 'global', resolution: 28 },
  { id: 'gfs_graphcast', label: 'GraphCast 25km', color: '#E6194B', maxHours: 384, weight: 12, type: 'ai', region: 'global', resolution: 25 },
  { id: 'ncep_aigfs', label: 'AIGFS 25km', color: '#3CB44B', maxHours: 384, weight: 10, type: 'ai', region: 'global', resolution: 25 },

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
  | 'humidity' | 'uv_index' | 'pressure' | 'dewpoint' | 'visibility'
  | 'sea_surface_temperature'
  | 'wave_height' | 'wave_period' | 'wave_direction'
  | 'wind_wave_height' | 'wind_wave_period'
  | 'swell_wave_height' | 'swell_wave_period'

export interface Metric {
  id: MetricId
  label: string
  unit: string
  hourlyParam: string
  group: 'land' | 'marine'
}

export const METRICS: Metric[] = [
  { id: 'temperature', label: 'Temperature', unit: '°C', hourlyParam: 'temperature_2m', group: 'land' },
  { id: 'cloud_cover', label: 'Cloud Cover', unit: '%', hourlyParam: 'cloud_cover', group: 'land' },
  { id: 'wind_speed', label: 'Wind Speed', unit: 'km/h', hourlyParam: 'wind_speed_10m', group: 'land' },
  { id: 'wind_gusts', label: 'Wind Gusts', unit: 'km/h', hourlyParam: 'wind_gusts_10m', group: 'land' },
  { id: 'precipitation', label: 'Precipitation', unit: 'mm/h', hourlyParam: 'precipitation', group: 'land' },
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
export type EnsemblePreset = 'temperature' | 'precipitation' | 'precipitation_probability'

export interface EnsembleDefinition {
  id: EnsemblePreset
  label: string
  description: string
  /** Weights by lead time bucket. Keys are hour ranges. */
  weights: Record<string, Record<string, number>>
}

export const ENSEMBLE_PRESETS: EnsembleDefinition[] = [
  {
    id: 'temperature',
    label: 'Temperature',
    description: 'Optimized for temperature accuracy (MAE, RMSE)',
    weights: {
      '0-48h': {
        ecmwf_ifs: 0.30, icon_eu: 0.22, icon_global: 0.15,
        meteofrance_arpege_europe: 0.12, gfs_global: 0.08, gem_global: 0.07,
        meteofrance_arome_france: 0.04, meteofrance_arome_france_hd: 0.02,
      },
      '48-96h': {
        ecmwf_ifs: 0.35, icon_eu: 0.25, icon_global: 0.18,
        meteofrance_arpege_europe: 0.10, gfs_global: 0.07, gem_global: 0.05,
      },
      '96-168h': {
        ecmwf_ifs: 0.40, icon_global: 0.28, gfs_global: 0.18, gem_global: 0.14,
      },
    },
  },
  {
    id: 'precipitation',
    label: 'Precipitation',
    description: 'Optimized for precipitation amount accuracy (mm/h)',
    weights: {
      '0-48h': {
        icon_eu: 0.25, meteofrance_arpege_europe: 0.20, ecmwf_ifs: 0.18,
        icon_global: 0.12, gem_global: 0.10, gfs_global: 0.08,
        meteofrance_arome_france: 0.05, meteofrance_arome_france_hd: 0.02,
      },
      '48-96h': {
        icon_eu: 0.28, meteofrance_arpege_europe: 0.22, ecmwf_ifs: 0.20,
        icon_global: 0.15, gem_global: 0.08, gfs_global: 0.07,
      },
      '96-168h': {
        gfs_global: 0.30, ecmwf_ifs: 0.28, icon_global: 0.24, gem_global: 0.18,
      },
    },
  },
  {
    id: 'precipitation_probability',
    label: 'Rain Probability',
    description: 'Optimized for rain detection accuracy (POD, FAR, CSI)',
    weights: {
      '0-48h': {
        icon_eu: 0.25, ecmwf_ifs: 0.22, meteofrance_arpege_europe: 0.18,
        icon_global: 0.12, gem_global: 0.10, gfs_global: 0.06,
        meteofrance_arome_france: 0.05, meteofrance_arome_france_hd: 0.02,
      },
      '48-96h': {
        icon_eu: 0.28, ecmwf_ifs: 0.25, meteofrance_arpege_europe: 0.18,
        icon_global: 0.15, gem_global: 0.08, gfs_global: 0.06,
      },
      '96-168h': {
        ecmwf_ifs: 0.30, icon_global: 0.28, gfs_global: 0.24, gem_global: 0.18,
      },
    },
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
  return '96-168h'
}

/**
 * Get the ensemble preset for a given metric and lead time.
 * Falls back to the shortest bucket for unknown metrics.
 */
export function getEnsembleForMetric(
  metricId: string,
  leadTimeHours: number = 0
): { preset: EnsembleDefinition; bucket: string; weights: Record<string, number> } {
  const presetId = METRIC_TO_ENSEMBLE[metricId] ?? 'temperature'
  const preset = ENSEMBLE_PRESETS.find(p => p.id === presetId) ?? ENSEMBLE_PRESETS[0]
  const bucket = getLeadTimeBucket(leadTimeHours)
  const weights = preset.weights[bucket] ?? preset.weights['0-48h']
  return { preset, bucket, weights }
}

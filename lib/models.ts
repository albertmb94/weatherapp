export interface WeatherModel {
  id: string
  label: string
  color: string
  maxHours: number
  weight: number
}

export const MODELS: WeatherModel[] = [
  { id: 'meteofrance_arome_france_hd', label: 'AROME-FR 1.3km', color: '#e6194B', maxHours: 48, weight: 32 },
  { id: 'dmi_harmonie_arome_europe', label: 'HARM-DK 2km', color: '#f58231', maxHours: 60, weight: 25 },
  { id: 'knmi_harmonie_arome_europe', label: 'HARMONIE 5km', color: '#ffe119', maxHours: 60, weight: 8 },
  { id: 'icon_eu', label: 'ICON-EU 7km', color: '#3cb44b', maxHours: 120, weight: 6 },
  { id: 'meteofrance_arome_france', label: 'AROME-FR2 1.3km', color: '#42d4f4', maxHours: 96, weight: 4 },
  { id: 'meteofrance_arpege_europe', label: 'ARPEGE-EU 10km', color: '#bfef45', maxHours: 96, weight: 15 },
  { id: 'icon_global', label: 'ICON 13km', color: '#911eb4', maxHours: 240, weight: 4 },
  { id: 'gfs_global', label: 'GFS 13km', color: '#f032e6', maxHours: 384, weight: 3 },
  { id: 'gem_global', label: 'GDPS 15km', color: '#a9a9a9', maxHours: 240, weight: 2 },
  { id: 'marine_global', label: 'Marine', color: '#06b6d4', maxHours: 0, weight: 0 },
]

export type MetricId =
  | 'temperature' | 'cloud_cover' | 'wind_speed' | 'wind_gusts' | 'precipitation'
  | 'humidity' | 'uv_index' | 'pressure' | 'dewpoint' | 'visibility'
  | 'sea_surface_temperature'
  | 'wave_height' | 'wave_period' | 'wave_direction'
  | 'wind_wave_height' | 'wind_wave_period'
  | 'swell_wave_height' | 'swell_wave_period'
  | 'all'

export interface Metric {
  id: MetricId
  label: string
  unit: string
  hourlyParam: string
  group: 'land' | 'marine'
}

export const METRICS: Metric[] = [
  { id: 'all', label: 'All Metrics', unit: '', hourlyParam: '', group: 'land' },
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

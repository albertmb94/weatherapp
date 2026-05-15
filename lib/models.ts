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
  { id: 'icon_d2', label: 'ICON-D2 2.8km', color: '#bfef45', maxHours: 48, weight: 15 },
  { id: 'knmi_harmonie_arome_europe', label: 'HARMONIE 5km', color: '#ffe119', maxHours: 60, weight: 8 },
  { id: 'icon_eu', label: 'ICON-EU 7km', color: '#3cb44b', maxHours: 120, weight: 6 },
  { id: 'meteofrance_arome_france', label: 'WRF 9km*', color: '#42d4f4', maxHours: 96, weight: 4 },
  { id: 'icon_global', label: 'ICON 13km', color: '#911eb4', maxHours: 240, weight: 4 },
  { id: 'gfs_global', label: 'GFS 13km', color: '#f032e6', maxHours: 384, weight: 3 },
  { id: 'gem_global', label: 'GDPS 15km', color: '#a9a9a9', maxHours: 240, weight: 2 },
]

export type MetricId = 'temperature' | 'cloud_cover' | 'wind_speed' | 'wind_gusts' | 'precipitation' | 'all'

export interface Metric {
  id: MetricId
  label: string
  unit: string
  hourlyParam: string
}

export const METRICS: Metric[] = [
  { id: 'all', label: 'All Metrics', unit: '', hourlyParam: '' },
  { id: 'temperature', label: 'Temperature', unit: '°C', hourlyParam: 'temperature_2m' },
  { id: 'cloud_cover', label: 'Cloud Cover', unit: '%', hourlyParam: 'cloud_cover' },
  { id: 'wind_speed', label: 'Wind Speed', unit: 'km/h', hourlyParam: 'wind_speed_10m' },
  { id: 'wind_gusts', label: 'Wind Gusts', unit: 'km/h', hourlyParam: 'wind_gusts_10m' },
  { id: 'precipitation', label: 'Precipitation', unit: 'mm/h', hourlyParam: 'precipitation' },
]

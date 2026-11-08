export type WeatherIconId = 'sunny' | 'partly' | 'cloudy' | 'rainy' | 'stormy' | 'snowy'

export const WEATHER_ICON_IDS: readonly WeatherIconId[] = [
  'sunny', 'partly', 'cloudy', 'rainy', 'stormy', 'snowy',
]

export interface IconInput {
  cloudCoverPct: number | null
  precipitationMmDay: number | null
  windGustsKmh: number | null
  minTempC: number | null
  /** Explicit WMO code; rain totals and wind alone cannot identify thunder. */
  weatherCode?: number | null
  /** Threshold in the same accumulation interval as precipitationMmDay. */
  precipitationThresholdMm?: number
}

export function pickWeatherIcon({ cloudCoverPct, precipitationMmDay, minTempC, weatherCode, precipitationThresholdMm = 1 }: IconInput): WeatherIconId {
  const precip = precipitationMmDay ?? 0
  const cloud = cloudCoverPct ?? 0
  const tMin = minTempC ?? 99

  if (weatherCode === 95 || weatherCode === 96 || weatherCode === 99) return 'stormy'
  if (precip >= precipitationThresholdMm && tMin <= 1) return 'snowy'
  if (precip >= precipitationThresholdMm) return 'rainy'
  if (cloud >= 75) return 'cloudy'
  if (cloud >= 30) return 'partly'
  return 'sunny'
}

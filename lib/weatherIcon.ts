export type WeatherIconId = 'sunny' | 'partly' | 'cloudy' | 'rainy' | 'stormy' | 'snowy'

export const WEATHER_ICON_IDS: readonly WeatherIconId[] = [
  'sunny', 'partly', 'cloudy', 'rainy', 'stormy', 'snowy',
]

export interface IconInput {
  cloudCoverPct: number | null
  precipitationMmDay: number | null
  windGustsKmh: number | null
  minTempC: number | null
}

export function pickWeatherIcon({ cloudCoverPct, precipitationMmDay, windGustsKmh, minTempC }: IconInput): WeatherIconId {
  const precip = precipitationMmDay ?? 0
  const gusts = windGustsKmh ?? 0
  const cloud = cloudCoverPct ?? 0
  const tMin = minTempC ?? 99

  if (precip >= 1 && tMin <= 1) return 'snowy'
  if (precip >= 8 || gusts >= 80) return 'stormy'
  if (precip >= 1) return 'rainy'
  if (cloud >= 75) return 'cloudy'
  if (cloud >= 30) return 'partly'
  return 'sunny'
}

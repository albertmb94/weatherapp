import type { Metric } from './models'
import { fetchWithTimeout } from './fetchWithTimeout'
import { parseOpenMeteoTimes } from './dateUtils'

export const MARINE_API_DAYS_MAX = 7

export interface MarineResult {
  time: Date[]
  series: Record<string, Record<string, (number | null)[]>>
  utcOffsetSeconds: number
}

interface MarineRaw {
  hourly: {
    time: string[]
    wave_height?: (number | null)[]
    wave_period?: (number | null)[]
    wave_direction?: (number | null)[]
    wind_wave_height?: (number | null)[]
    wind_wave_period?: (number | null)[]
    swell_wave_height?: (number | null)[]
    swell_wave_period?: (number | null)[]
  }
  utc_offset_seconds?: number
}

export function computeMarineDays(rangeHours: number, maxDays: number = MARINE_API_DAYS_MAX): number {
  return Math.max(1, Math.min(Math.ceil(rangeHours / 24), maxDays))
}

/**
 * Fetch marine (wave) data from the internal /api/marine proxy. The proxy
 * forwards to Open-Meteo's marine-api.open-meteo.com and applies the same
 * retry / cache pipeline as the regular forecast endpoint.
 *
 * The Open-Meteo marine API does not accept a `models=` parameter: wave
 * data comes from a single global model. We expose the result in the same
 * shape as `fetchForecast` so the rest of the pipeline can treat it as a
 * virtual model with id `marine_global`.
 */
export async function fetchMarine(
  lat: number,
  lon: number,
  metrics: Metric[],
  forecastDays: number,
  signal?: AbortSignal
): Promise<MarineResult> {
  const marineMetrics = metrics.filter(m => m.id !== 'all' && m.group === 'marine')
  const hourlyList = marineMetrics.map(m => m.hourlyParam)

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: hourlyList.join(','),
    forecast_days: forecastDays.toString(),
    timezone: 'auto',
  })

  const res = await fetchWithTimeout(`/api/marine?${params}`, { signal, timeoutMs: 20_000 })
  if (!res.ok) throw new Error(`Marine API error: ${res.status}`)
  const data: MarineRaw = await res.json()

  const time = parseOpenMeteoTimes(data.hourly.time)
  const series: Record<string, Record<string, (number | null)[]>> = {
    marine_global: {},
  }

  for (const metric of marineMetrics) {
    const arr = data.hourly[metric.hourlyParam as keyof MarineRaw['hourly']] as (number | null)[] | undefined
    series.marine_global[metric.id] = arr ?? new Array(time.length).fill(null)
  }

  return { time, series, utcOffsetSeconds: data.utc_offset_seconds ?? 0 }
}

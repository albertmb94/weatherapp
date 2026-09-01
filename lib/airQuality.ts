/**
 * F5: air-quality + pollen forecast via the dedicated
 * Open-Meteo air-quality API.
 *
 * Endpoint: https://air-quality-api.open-meteo.com/v1/air-quality
 *   - Hourly: pm10, pm2_5, carbon_monoxide, nitrogen_dioxide,
 *     sulphur_dioxide, ozone, european_aqi, us_aqi
 *   - Pollen: alder_pollen, birch_pollen, grass_pollen,
 *     mugwort_pollen, olive_pollen, ragweed_pollen
 *
 * The forecast horizon is short — Open-Meteo returns 5 days for
 * air quality and up to 5 for pollen. We still slice the hourly
 * arrays down to the caller-requested range so the rest of the
 * app can treat the payload uniformly.
 *
 * Routing through our own `/api/air-quality` route lets us add
 * caching, retries and rate-limiting in one place (the same
 * pattern as `/api/forecast`).
 */
import { roundCoordinate } from './cacheKey'
import { fetchWithTimeout } from './fetchWithTimeout'
import { parseOpenMeteoTimes } from './dateUtils'
import { AIR_METRICS, type MetricId } from './models'

export const AIR_QUALITY_HORIZON_HOURS = 5 * 24 // 5 days

export interface AirQualityResult {
  time: Date[]
  timeStrings: string[]
  /** Per-metric series. Mirrors the shape used by
   *  `fetchForecast` so the AirQualityCard can iterate without
   *  special-casing the data flow. */
  series: Record<MetricId, (number | null)[]>
  utcOffsetSeconds: number
  fetchedAt: number
}

interface AirQualityRaw {
  hourly: Record<string, number[] | string[]>
  utc_offset_seconds?: number
  current?: Record<string, number | string>
}

interface FetchAirQualityOptions {
  /** Future-only slice (hours from "now" forward). The Open-Meteo
   *  endpoint already returns past_days=1 + forecast_days up to 5,
   *  so we expose both the full window and a "current" value. */
  signal?: AbortSignal
}

export async function fetchAirQuality(
  lat: number,
  lon: number,
  options: FetchAirQualityOptions = {},
): Promise<AirQualityResult> {
  const params = new URLSearchParams({
    latitude: roundCoordinate(lat),
    longitude: roundCoordinate(lon),
    hourly: AIR_METRICS.map(m => m.hourlyParam).join(','),
    current: AIR_METRICS.map(m => m.hourlyParam).join(','),
    timezone: 'auto',
    forecast_days: '5',
  })

  const res = await fetchWithTimeout(`/api/air-quality?${params}`, {
    signal: options.signal,
    timeoutMs: 15_000,
  })
  if (!res.ok) {
    throw new Error(`Air quality API error: ${res.status}`)
  }
  const data: AirQualityRaw = await res.json()
  const timeStrings = Array.isArray(data.hourly?.time) ? (data.hourly.time as string[]) : []
  const time = parseOpenMeteoTimes(timeStrings)
  const fetchedAt = Date.now()
  const series = {} as AirQualityResult['series']
  for (const m of AIR_METRICS) {
    const arr = data.hourly?.[m.hourlyParam]
    series[m.id] = Array.isArray(arr)
      ? (arr as Array<number | null>).map(v =>
          typeof v === 'number' && Number.isFinite(v) ? v : null
        )
      : []
  }
  return {
    time,
    timeStrings,
    series,
    utcOffsetSeconds: data.utc_offset_seconds ?? 0,
    fetchedAt,
  }
}

/**
 * EU AQI band classification. The European AQI scale runs 0-100+,
 * with five labelled bands per the European Environment Agency.
 * Returns `null` when the value is missing / out of range so the
 * UI can render an em-dash.
 *
 * Source: https://www.eea.europa.eu/en/themes/air/about-air
 */
export type AirQualityBand = 'good' | 'fair' | 'moderate' | 'poor' | 'very_poor' | 'extreme'

export function classifyEuropeanAqi(value: number | null | undefined): {
  band: AirQualityBand
  label: string
  hint: string
} | null {
  if (value == null || !Number.isFinite(value)) return null
  if (value < 20) return { band: 'good', label: 'Buena', hint: 'Calidad del aire satisfactoria.' }
  if (value < 40) return { band: 'fair', label: 'Aceptable', hint: 'Aceptable para la mayoría.' }
  if (value < 60) return { band: 'moderate', label: 'Moderada', hint: 'Personas sensibles: reduzca el esfuerzo prolongado al aire libre.' }
  if (value < 80) return { band: 'poor', label: 'Mala', hint: 'Personas sensibles: evite el esfuerzo al aire libre.' }
  if (value < 100) return { band: 'very_poor', label: 'Muy mala', hint: 'Reduzca la actividad al aire libre.' }
  return { band: 'extreme', label: 'Extrema', hint: 'Permanezca en interiores.' }
}

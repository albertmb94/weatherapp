import type { Metric } from './models'
import { fetchWithTimeout } from './fetchWithTimeout'
import { parseOpenMeteoTimes } from './dateUtils'

export const MARINE_API_DAYS_MAX = 7

// Sea surface temperature has to be requested on its own. The marine API
// resolves `best_match` to a single model per request, so mixing SST with the
// wave variables makes it pick a wave model that returns null SST. Fetching it
// in an isolated request (just `hourly=sea_surface_temperature`, no `models=`,
// which the marine endpoint does not accept) lets best_match pick the ocean
// model that actually serves it.
export const SST_METRIC_ID = 'sea_surface_temperature'

export interface MarineResult {
  time: Date[]
  timeStrings: string[]
  series: Record<string, Record<string, (number | null)[]>>
  utcOffsetSeconds: number
}

interface MarineRaw {
  hourly: Record<string, unknown> & { time: string[] }
  utc_offset_seconds?: number
}

export function computeMarineDays(rangeHours: number, maxDays: number = MARINE_API_DAYS_MAX): number {
  return Math.max(1, Math.min(Math.ceil(rangeHours / 24), maxDays))
}

function numberArray(value: unknown, length: number): (number | null)[] {
  if (!Array.isArray(value)) return new Array(length).fill(null)
  return value.map(v => (typeof v === 'number' ? v : null))
}

/**
 * Fetch the sea surface temperature series in an isolated request and return it
 * aligned to the canonical `baseTimeStrings` grid (the wave grid). `cell_selection=sea`
 * snaps near-shore coordinates to the nearest ocean cell so coastal points
 * still resolve to data.
 */
async function fetchSeaSurfaceTemperature(
  lat: number,
  lon: number,
  forecastDays: number,
  baseTimeStrings: string[],
  signal?: AbortSignal
): Promise<(number | null)[]> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: SST_METRIC_ID,
    cell_selection: 'sea',
    forecast_days: forecastDays.toString(),
    timezone: 'auto',
  })

  const res = await fetchWithTimeout(`/api/marine?${params}`, { signal, timeoutMs: 20_000 })
  if (!res.ok) throw new Error(`Marine SST API error: ${res.status}`)
  const data: MarineRaw = await res.json()

  const sstKey = Object.keys(data.hourly).find(k => k.startsWith(SST_METRIC_ID))
  if (!sstKey) return new Array(baseTimeStrings.length).fill(null)

  const sstTimes = data.hourly.time
  const sstValues = numberArray(data.hourly[sstKey], sstTimes.length)

  // Align to the wave time grid by timestamp so a different start hour or
  // length on the ocean model never shifts the values.
  const byTime = new Map<string, number | null>()
  for (let i = 0; i < sstTimes.length; i++) byTime.set(sstTimes[i], sstValues[i] ?? null)
  return baseTimeStrings.map(t => byTime.get(t) ?? null)
}

/**
 * Fetch marine (wave) data from the internal /api/marine proxy. The proxy
 * forwards to Open-Meteo's marine-api.open-meteo.com and applies the same
 * retry / cache pipeline as the regular forecast endpoint.
 *
 * Wave variables come from the marine `best_match` model (no `models=`), while
 * sea surface temperature is fetched separately from a dedicated ocean model
 * and merged in. We expose the result in the same shape as `fetchForecast` so
 * the rest of the pipeline can treat it as a virtual model `marine_global`.
 */
export async function fetchMarine(
  lat: number,
  lon: number,
  metrics: Metric[],
  forecastDays: number,
  signal?: AbortSignal
): Promise<MarineResult> {
const marineMetrics = metrics.filter(m => m.group === 'marine')
  const waveMetrics = marineMetrics.filter(m => m.id !== SST_METRIC_ID)
  const wantsSst = marineMetrics.some(m => m.id === SST_METRIC_ID)
  const hourlyList = waveMetrics.map(m => m.hourlyParam)

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

  const timeStrings = data.hourly.time
  const time = parseOpenMeteoTimes(timeStrings)
  const series: Record<string, Record<string, (number | null)[]>> = {
    marine_global: {},
  }

  for (const metric of waveMetrics) {
    series.marine_global[metric.id] = numberArray(data.hourly[metric.hourlyParam], time.length)
  }

  // SST lives on a separate model; fetch it on its own and merge. A failure
  // here must not take down the wave data, so it degrades to a null series.
  if (wantsSst) {
    try {
      series.marine_global[SST_METRIC_ID] = await fetchSeaSurfaceTemperature(
        lat, lon, forecastDays, timeStrings, signal
      )
    } catch (err) {
      console.warn('marine SST fetch failed', err)
      series.marine_global[SST_METRIC_ID] = new Array(time.length).fill(null)
    }
  }

  return { time, timeStrings, series, utcOffsetSeconds: data.utc_offset_seconds ?? 0 }
}

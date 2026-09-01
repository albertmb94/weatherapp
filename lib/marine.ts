import { roundCoordinate } from './cacheKey'
import type { Metric, MetricId } from './models'
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
    latitude: roundCoordinate(lat),
    longitude: roundCoordinate(lon),
    hourly: SST_METRIC_ID,
    cell_selection: 'sea',
    past_days: '3',
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
    latitude: roundCoordinate(lat),
    longitude: roundCoordinate(lon),
    hourly: hourlyList.join(','),
    cell_selection: 'sea',
    past_days: '3',
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
    const values = numberArray(data.hourly[metric.hourlyParam], time.length)
    series.marine_global[metric.id] = values
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

/**
 * Sprint 14: grid variant of `fetchMarine`. The map heatmap needs
 * the same marine metric at N coordinates (a 6×8 grid = 48 points
 * by default); calling `fetchMarine` for each point would issue 48
 * sequential `/api/marine` requests and a serial SST pass. Instead
 * we run all the points through `fetchMarine` in parallel batches
 * so the map heatmap can render the marine layer without the
 * previous "always-null" dead end.
 *
 * Output shape matches `fetchHeatmapGrid`: `series[i]` is the
 * value-array for grid point `i`, ordered the same as `latLngs`.
 * When a grid point has no data (out-of-coverage, fetch rejected,
 * etc.) the corresponding entry is `null`. The `times` array is
 * shared by every entry and reflects the union of the timestamps
 * the underlying requests returned; in practice the API uses
 * `timezone=auto` and `forecast_days` uniformly so the timestamps
 * match across points.
 *
 * Concurrency is bounded by `MAX_CONCURRENCY` (default 6) so a
 * single map heatmap fetch never exceeds 6 simultaneous
 * `/api/marine` calls; on mobile that matters because the API has
 * a per-IP rate limit and we don't want a heatmap zoom-in to lock
 * out the rest of the app.
 */
export interface MarineGridResult {
  series: (number | null)[][]
  times: Date[]
  /** True when at least one grid point had no usable data. The map
   *  surfaces this as a soft warning rather than an error — partial
   *  coverage (e.g. half over sea, half over land) is expected when
   *  the user pans inland. */
  partialCoverage: boolean
}

const MAX_CONCURRENCY = 6

export async function fetchMarineGrid(
  latLngs: { lat: number; lng: number }[],
  metric: MetricId,
  forecastDays: number,
  signal?: AbortSignal
): Promise<MarineGridResult> {
  if (latLngs.length === 0) {
    return { series: [], times: [], partialCoverage: false }
  }
  // Inline `as const` so TypeScript keeps the `id` literal types
  // (MetricId) instead of widening them to plain `string`. The
  // previous form (a plain object literal) lost the literal type
  // and broke `.find(m => m.id === metric)` because the resulting
  // type's `id` field was just `string`, not assignable to
  // MetricId. The `as Metric[]` then re-establishes the
  // structured shape.
  const marineMetrics: Metric[] = [
    { id: 'sea_surface_temperature', label: '', unit: '', hourlyParam: 'sea_surface_temperature', group: 'marine' },
    { id: 'wave_height', label: '', unit: '', hourlyParam: 'wave_height', group: 'marine' },
    { id: 'wave_period', label: '', unit: '', hourlyParam: 'wave_period', group: 'marine' },
    { id: 'wave_direction', label: '', unit: '', hourlyParam: 'wave_direction', group: 'marine' },
    { id: 'wind_wave_height', label: '', unit: '', hourlyParam: 'wind_wave_height', group: 'marine' },
    { id: 'wind_wave_period', label: '', unit: '', hourlyParam: 'wind_wave_period', group: 'marine' },
    { id: 'swell_wave_height', label: '', unit: '', hourlyParam: 'swell_wave_height', group: 'marine' },
    { id: 'swell_wave_period', label: '', unit: '', hourlyParam: 'swell_wave_period', group: 'marine' },
  ]
  const metricDef = marineMetrics.find(m => m.id === metric)
  if (!metricDef) {
    return { series: latLngs.map(() => []), times: [], partialCoverage: true }
  }

  const out: ((number | null)[] | null)[] = new Array(latLngs.length).fill(null)
  let times: Date[] = []
  let partialCoverage = false

  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < latLngs.length) {
      if (signal?.aborted) return
      const idx = cursor++
      const { lat, lng } = latLngs[idx]
      try {
        const result = await fetchMarine(lat, lng, [metricDef!], forecastDays, signal)
        if (signal?.aborted) return
        if (times.length === 0) times = result.time
        const values = result.series.marine_global?.[metricDef!.id] ?? []
        out[idx] = values.length > 0 ? values : null
        if (values.length === 0) partialCoverage = true
      } catch {
        if (signal?.aborted) return
        out[idx] = null
        partialCoverage = true
      }
    }
  }

  const concurrency = Math.min(MAX_CONCURRENCY, latLngs.length)
  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  return {
    series: out.map(v => v ?? []),
    times,
    partialCoverage,
  }
}

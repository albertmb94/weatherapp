import type { WeatherModel, Metric, MetricId } from './models'
import { METRICS, MODELS } from './models'
import { fetchWithTimeout } from './fetchWithTimeout'
import { fetchMarine, computeMarineDays } from './marine'
import { parseOpenMeteoTimes } from './dateUtils'
import { HEATMAP_MAX_MODELS } from './heatmapConfig'
import { selectModelsForLocation } from './regionDetection'

const MAX_FORECAST_MODELS = 10
const MAX_HEATMAP_MODELS = HEATMAP_MAX_MODELS

// Open-Meteo only returns hourly `uv_index` data when the forecast horizon
// is at least 7 days. For shorter ranges the key is missing from the
// response, so we always request at least this many days — the caller still
// slices down to the user's selected range for display.
export const UV_MIN_FORECAST_DAYS = 7

// Models effectively cover long horizons globally — we treat these as the
// "long-range tier" that must be included whenever the requested horizon
// exceeds what the high-res regional models can provide. Each model has
// patchy coverage (e.g. GFS returns null for much of Europe; ICON returns
// null in some regions), so we send all of them and let Open-Meteo fill in
// whichever has data.
const LONG_RANGE_MIN_HOURS = 168

function capModels(models: WeatherModel[], max: number, forecastDays?: number): WeatherModel[] {
  if (models.length <= max) return models
  const sorted = [...models].sort((a, b) => b.weight - a.weight)
  const picked = sorted.slice(0, max)
  if (forecastDays !== undefined) {
    const requiredHours = forecastDays * 24
    if (!picked.some(m => m.maxHours >= requiredHours)) {
      // Append every long-range model not already picked. Redundancy matters:
      // a single global model can return all-null for a given location.
      for (const m of sorted) {
        if (m.maxHours >= LONG_RANGE_MIN_HOURS && !picked.includes(m)) picked.push(m)
      }
    }
  }
  return picked
}

export function computeForecastDays(rangeHours: number, maxDays: number): number {
  return Math.max(Math.min(Math.ceil(rangeHours / 24), maxDays), UV_MIN_FORECAST_DAYS)
}

export interface ForecastResult {
  time: Date[]
  timeStrings: string[]
  series: Record<string, Record<string, (number | null)[]>>
  utcOffsetSeconds: number
}

export async function fetchForecast(
  lat: number,
  lon: number,
  models: WeatherModel[],
  metrics: Metric[],
  forecastDays = 7,
  signal?: AbortSignal,
  includeMarine = false
): Promise<ForecastResult> {
  const landModels = models.filter(m => m.id !== 'marine_global')
  // Use region-aware selection: prioritize high-res regional models for the
  // user's location, then cap at MAX_FORECAST_MODELS.
  const regionSelected = selectModelsForLocation(landModels, lat, lon, forecastDays)
  const capped = regionSelected.slice(0, MAX_FORECAST_MODELS)
  const modelIds = capped.map(m => m.id).join(',')
  // Only send land metrics to the forecast API. Marine metrics are
  // fetched separately via fetchMarine and merged in later.
  const hourlyList = metrics.filter(m => m.group === 'land').map(m => m.hourlyParam)
  // Always fetch wind direction so insights can render a direction arrow.
  if (!hourlyList.includes('wind_direction_10m')) hourlyList.push('wind_direction_10m')

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: hourlyList.join(','),
    models: modelIds,
    past_days: '3',
    forecast_days: forecastDays.toString(),
    timezone: 'auto',
  })

  const res = await fetchWithTimeout(`/api/forecast?${params}`, { signal, timeoutMs: 20_000 })
  if (!res.ok) throw new Error(`Forecast API error: ${res.status}`)
  const data = await res.json()

  const timeStrings = data.hourly.time as string[]
  const time = parseOpenMeteoTimes(timeStrings)
  const series: Record<string, Record<string, (number | null)[]>> = {}

  for (const model of capped) {
    series[model.id] = {}
    for (const metric of metrics) {
      const key = `${metric.hourlyParam}_${model.id}`
      series[model.id][metric.id] = data.hourly[key] ?? null
    }
    series[model.id]['wind_direction'] = data.hourly[`wind_direction_10m_${model.id}`] ?? null
  }

  // Always fetch marine data - it's a tiny API call and eliminates state/caching issues
  {
    const marineDays = computeMarineDays(forecastDays * 24)
    try {
      const marine = await fetchMarine(lat, lon, metrics, marineDays, signal)
      const marineLen = marine.timeStrings.length
      if (marineLen > 0) {
        series.marine_global = series.marine_global ?? {}
        // Align marine data by canonical hour key so it works even when
        // the marine API uses a different timezone than the land API
        // (e.g. marine may return UTC while land returns local time).
        const landHourIndex = new Map<number, number>()
        for (let i = 0; i < time.length; i++) {
          landHourIndex.set(Math.floor(time[i].getTime() / 3600000), i)
        }
        for (const [metricId, values] of Object.entries(marine.series.marine_global)) {
          const aligned = new Array(timeStrings.length).fill(null) as (number | null)[]
          for (let j = 0; j < marineLen; j++) {
            const hourKey = Math.floor(marine.time[j].getTime() / 3600000)
            const idx = landHourIndex.get(hourKey)
            if (idx !== undefined) aligned[idx] = values[j]
          }
          series.marine_global[metricId] = aligned
        }
      }
    } catch (err) {
      console.warn('[Marine] fetch failed', err)
    }
  }

  return { time, timeStrings, series, utcOffsetSeconds: data.utc_offset_seconds ?? 0 }
}

/**
 * Fetches a grid of forecast series in a single bulk call to Open-Meteo.
 *
 *
 * `modelIds` is the list of models to include. If the array contains a single
 * model, that model's series is returned per point. If it contains multiple,
 * a weighted mean (by WeatherModel.weight) is computed client-side using only
 * the listed models. If it is empty, the weighted mean uses every model in
 * MODELS (full ensemble).
 *
 * Returns one array per grid point, in the same order as the input latLngs.
 * Out-of-coverage positions return null entries.
 */
export interface HeatmapGridResult {
  series: (number | null)[][]
  times: Date[]
  /** B-NEW-5: when true, the user selected more models than
   *  HEATMAP_MAX_MODELS and the heatmap only reflects the top-N by
   *  weight. The UI should warn the user. */
  modelCapExceeded: boolean
  requestedModels: number
  usedModels: number
}

export async function fetchHeatmapGrid(
  latLngs: { lat: number; lng: number }[],
  modelIds: string[],
  metric: MetricId,
  forecastDays: number,
  signal?: AbortSignal
): Promise<HeatmapGridResult> {
  if (latLngs.length === 0) {
    return { series: [], times: [], modelCapExceeded: false, requestedModels: 0, usedModels: 0 }
  }

  const hourlyParam = METRICS.find(m => m.id === metric)?.hourlyParam
  if (!hourlyParam) throw new Error(`Unknown metric: ${metric}`)

  const lats = latLngs.map(p => p.lat.toFixed(3)).join(',')
  const lngs = latLngs.map(p => p.lng.toFixed(3)).join(',')

  const requestedModels: WeatherModel[] = modelIds.length > 0
    ? MODELS.filter(m => modelIds.includes(m.id) && m.id !== 'marine_global')
    : MODELS.filter(m => m.id !== 'marine_global')
  const heatmapModels = capModels(requestedModels, MAX_HEATMAP_MODELS, forecastDays)
  const modelsParam = heatmapModels.map(m => m.id).join(',')

  const params = new URLSearchParams({
    latitude: lats,
    longitude: lngs,
    hourly: hourlyParam,
    models: modelsParam,
    forecast_days: forecastDays.toString(),
    timezone: 'auto',
  })

  const res = await fetchWithTimeout(`/api/forecast?${params}`, { signal, timeoutMs: 25_000 })
  if (!res.ok) throw new Error(`Heatmap API error: ${res.status}`)
  const data = await res.json()

  const points: { hourly?: Record<string, (number | null)[] | string[]> }[] = Array.isArray(data) ? data : [data]

  const firstWithTime = points.find(p => Array.isArray(p?.hourly?.time))
  const times: Date[] = firstWithTime
    ? (firstWithTime.hourly!.time as string[]).map(t => new Date(t))
    : []

  // Open-Meteo drops the model suffix when only one model is requested.
  const singleKey = hourlyParam
  const isSingle = heatmapModels.length === 1

  const series: (number | null)[][] = points.map(point => {
    const hourly = point?.hourly
    if (!hourly) return new Array(times.length).fill(null)

    if (isSingle) {
      const only = heatmapModels[0]
      const suffixed = `${hourlyParam}_${only.id}`
      const vals = (hourly[suffixed] ?? hourly[singleKey]) as (number | null)[] | undefined
      return vals ?? new Array(times.length).fill(null)
    }

    // Weighted mean across the requested models.
    const firstArr = (hourly[`${hourlyParam}_${heatmapModels[0].id}`] ?? hourly[singleKey]) as (number | null)[] | undefined
    const len = firstArr?.length ?? times.length
    const out: (number | null)[] = new Array(len).fill(null)
    for (let i = 0; i < len; i++) {
      let sum = 0
      let wSum = 0
      for (const m of heatmapModels) {
        const arr = hourly[`${hourlyParam}_${m.id}`] as (number | null)[] | undefined
        const v = arr?.[i]
        if (v !== null && v !== undefined) {
          sum += v * m.weight
          wSum += m.weight
        }
      }
      out[i] = wSum > 0 ? sum / wSum : null
    }
    return out
  })

  return {
    series,
    times,
    modelCapExceeded: requestedModels.length > heatmapModels.length,
    requestedModels: requestedModels.length,
    usedModels: heatmapModels.length,
  }
}

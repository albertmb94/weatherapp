import type { WeatherModel, Metric, MetricId } from './models'
import { METRICS, MODELS } from './models'

export interface ForecastResult {
  time: Date[]
  series: Record<string, Record<string, (number | null)[]>>
}

export async function fetchForecast(
  lat: number,
  lon: number,
  models: WeatherModel[],
  metrics: Metric[],
  forecastDays = 7,
  signal?: AbortSignal
): Promise<ForecastResult> {
  const modelIds = models.map(m => m.id).join(',')
  const hourlyParams = metrics.filter(m => m.id !== 'all').map(m => m.hourlyParam).join(',')

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: hourlyParams,
    models: modelIds,
    forecast_days: forecastDays.toString(),
    timezone: 'UTC',
  })

  const res = await fetch(`/api/forecast?${params}`, { signal })
  if (!res.ok) throw new Error(`Forecast API error: ${res.status}`)
  const data = await res.json()

  const time = data.hourly.time.map((t: string) => new Date(t))
  const series: Record<string, Record<string, (number | null)[]>> = {}

  for (const model of models) {
    series[model.id] = {}
    for (const metric of metrics) {
      if (metric.id === 'all') continue
      const key = `${metric.hourlyParam}_${model.id}`
      series[model.id][metric.id] = data.hourly[key] ?? null
    }
  }

  return { time, series }
}

export async function fetchSinglePoint(
  lat: number,
  lon: number,
  modelId: string,
  hourlyParam: string,
  forecastDays = 7,
  signal?: AbortSignal
): Promise<(number | null)[]> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: hourlyParam,
    models: modelId,
    forecast_days: forecastDays.toString(),
    timezone: 'UTC',
  })

  const res = await fetch(`/api/forecast?${params}`, { signal })
  if (!res.ok) throw new Error(`Forecast API error: ${res.status}`)
  const data = await res.json()

  const key = `${hourlyParam}_${modelId}`
  return data.hourly[key] ?? []
}

/**
 * Fetches a grid of forecast series in a single bulk call to Open-Meteo.
 *
 * If `modelId` is null, all MODELS are requested and a weighted mean (by
 * WeatherModel.weight) is computed client-side for each grid point.
 *
 * Returns one array per grid point, in the same order as the input latLngs.
 * Each array is the hourly series for the chosen metric. Out-of-coverage
 * positions return null entries.
 */
export interface HeatmapGridResult {
  series: (number | null)[][]
  times: Date[]
}

export async function fetchHeatmapGrid(
  latLngs: { lat: number; lng: number }[],
  modelId: string | null,
  metric: Exclude<MetricId, 'all'>,
  forecastDays: number,
  signal?: AbortSignal
): Promise<HeatmapGridResult> {
  if (latLngs.length === 0) return { series: [], times: [] }

  const hourlyParam = METRICS.find(m => m.id === metric)?.hourlyParam
  if (!hourlyParam) throw new Error(`Unknown metric: ${metric}`)

  const lats = latLngs.map(p => p.lat.toFixed(3)).join(',')
  const lngs = latLngs.map(p => p.lng.toFixed(3)).join(',')

  const useModels = modelId ? [modelId] : MODELS.map(m => m.id)
  const modelsParam = useModels.join(',')

  const params = new URLSearchParams({
    latitude: lats,
    longitude: lngs,
    hourly: hourlyParam,
    models: modelsParam,
    forecast_days: forecastDays.toString(),
    timezone: 'UTC',
  })

  const res = await fetch(`/api/forecast?${params}`, { signal })
  if (!res.ok) throw new Error(`Heatmap API error: ${res.status}`)
  const data = await res.json()

  const points: { hourly?: Record<string, (number | null)[] | string[]> }[] = Array.isArray(data) ? data : [data]

  // Reference times from the first point that has them.
  const firstWithTime = points.find(p => Array.isArray(p?.hourly?.time))
  const times: Date[] = firstWithTime
    ? (firstWithTime.hourly!.time as string[]).map(t => new Date(t))
    : []

  // Open-Meteo drops the model suffix when only one model is requested.
  const singleKey = hourlyParam
  const series: (number | null)[][] = points.map(point => {
    const hourly = point?.hourly
    if (!hourly) return new Array(times.length).fill(null)

    if (modelId) {
      const suffixed = `${hourlyParam}_${modelId}`
      const vals = (hourly[suffixed] ?? hourly[singleKey]) as (number | null)[] | undefined
      if (!vals) return new Array(times.length).fill(null)
      return vals
    }

    // Weighted mean across all models.
    const firstArr = (hourly[`${hourlyParam}_${MODELS[0].id}`] ?? hourly[singleKey]) as (number | null)[] | undefined
    const len = firstArr?.length ?? times.length
    const out: (number | null)[] = new Array(len).fill(null)
    for (let i = 0; i < len; i++) {
      let sum = 0
      let wSum = 0
      for (const m of MODELS) {
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

  return { series, times }
}

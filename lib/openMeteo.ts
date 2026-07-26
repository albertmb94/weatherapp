import type { WeatherModel, Metric, MetricId } from './models'
import { METRICS, MODELS } from './models'
import { fetchWithTimeout } from './fetchWithTimeout'
import { fetchMarine, computeMarineDays } from './marine'
import { parseOpenMeteoTimes } from './dateUtils'
import { HEATMAP_MAX_MODELS } from './heatmapConfig'
import { selectModelsForLocation } from './regionDetection'

const MAX_FORECAST_MODELS = 10
const MAX_HEATMAP_MODELS = HEATMAP_MAX_MODELS

// Open-Meteo historically returned hourly `uv_index` only for horizons of
// at least 7 days. The current provider catalogue answers `uv_index` for
// even one-day requests, but we keep the floor as a safety net so that a
// future contract regression cannot silently drop the UV column.
export const UV_MIN_FORECAST_DAYS = 7

// Models effectively cover long horizons globally — we treat these as the
// "long-range tier" that must be included whenever the requested horizon
// exceeds what the high-res regional models can provide. Each model has
// patchy coverage (e.g. GFS returns null for much of Europe; ICON returns
// null in some regions), so we send all of them and let Open-Meteo fill in
// whichever has data.
const LONG_RANGE_MIN_HOURS = 168


export function capModels(models: WeatherModel[], max: number, forecastDays?: number): WeatherModel[] {
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

export interface ForecastResult {
  time: Date[]
  timeStrings: string[]
  series: Record<string, Record<string, (number | null)[]>>
  utcOffsetSeconds: number
  /** Fetched-at timestamp (ms since epoch). Used to drive the 4h
   *  auto-refresh and surface data freshness in the UI. */
  fetchedAt: number
}

/** "Live" UV reading sourced from Open-Meteo `current=uv_index`. Comes
 *  separately because the hourly ensemble value lags ~15 min behind the
 *  hourly point containing the previous hour (floor), which is what the
 *  old "UV en vivo" label was silently displaying. */
export interface CurrentConditions {
  uvIndex: number | null
  uvIndexValidAt: Date | null
  /** Provider-reported update interval for `current_*` fields (seconds). */
  uvIndexIntervalSec: number | null
  /** True when the request returned a `current` block at all — false on
   *  models/locations the provider does not cover with current UV. */
  hasCurrent: boolean
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
  // user's location, then cap at MAX_FORECAST_MODELS. The tier-ordered
  // slice is intentional — `capModels` re-sorts globally by weight and
  // would pull in AI models (aifs025, graphcast025) and drop the
  // region-specific models (e.g. ARPEGE, AROME) that the actual data
  // covers better for Europe. The DailySummary math already falls back
  // to the long-range globals (ecmwf_ifs, icon_global, gfs_global) for
  // the day buckets beyond the regional horizons.
  const regionSelected = selectModelsForLocation(landModels, lat, lon, forecastDays)
  // B-NEW-3: the Open-Meteo `/v1/forecast` endpoint truncates the
  // `hourly.*` series arrays to the SHORTEST model's advertised range
  // when the request mixes short-range regionals (e.g. arome_france_hd
  // at 48h, dwd_icon_d2 at 48h) with long-range globals (gfs_global at
  // 384h). The `hourly.time` array still spans the full window the
  // caller asked for, but every per-model series is padded with `null`
  // after the shortest model's horizon — so the ensemble silently
  // collapses to ~2 days of data on the Insights table and the
  // DailySummary only computes tMin/tMax for the first 3 day buckets.
  // We verified this in production on 2026-07-24: Badalona's
  // DailySummary showed 3 valid days (Vie 24 / Sáb 25 / Dom 26) and
  // "–°" for Lun 27 onward. We therefore restrict the API request to
  // long-range models (maxHours ≥ 336, i.e. ≥ 14 days) so every
  // requested model can cover the full horizon. The DailySummary
  // ensemble still receives any short-range models the user selected
  // (via `displayActiveModelIds`); they just contribute null for the
  // hours the API didn't return, which `weightedAvg` already skips.
  //
  // B-NEW-4: bump `CACHE_KEY_VERSION` whenever the model-selection
  // logic or any other request-shaping parameter changes. The server
  // route hashes the URL into a cache key, so a stale entry from
  // before this fix would keep serving the truncated response for up
  // to the 4-hour TTL. The version stamp is included in the URL so
  // every prior entry is automatically invalidated and the user sees
  // the long-range payload on the next refresh. The route strips `v`
  // before forwarding to Open-Meteo so the upstream URL stays clean.
  const CACHE_KEY_VERSION = 'v3-long-range-2026-07-24'
  const MIN_HOURS_FOR_FORECAST = 336
  const longRange = regionSelected.filter(m => m.maxHours >= MIN_HOURS_FOR_FORECAST)
  const capped = longRange.slice(0, MAX_FORECAST_MODELS)
  const modelIds = capped.map(m => m.id).join(',')
  // Only send land metrics to the forecast API. Marine metrics are
  // fetched separately via fetchMarine and merged in later.
  const hourlyList = metrics.filter(m => m.group === 'land').map(m => m.hourlyParam)
  // Always fetch wind direction so insights can render a direction arrow.
  if (!hourlyList.includes('wind_direction_10m')) hourlyList.push('wind_direction_10m')

  // Sprint 10 / B-10-5 (E3): the request payload carries 3 past days
  // even though the consumer slices the array to start at the current
  // local hour. For short forecasts (≤ 7 days) we already have today's
  // 00:00 in the future forecast, so 1 past day is enough to bridge
  // the overnight gap. For longer forecasts we keep the 3-day tail.
  const pastDays = forecastDays <= 7 ? '1' : '3'

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: hourlyList.join(','),
    models: modelIds,
    past_days: pastDays,
    forecast_days: forecastDays.toString(),
    timezone: 'auto',
    // B-NEW-4: the `v` param is included in the cache key (via
    // buildForecastCacheKey) but stripped by the route before
    // forwarding to Open-Meteo. Bumping the value invalidates every
    // pre-existing entry in one shot, which is what we needed on
    // 2026-07-24 when the long-range model filter was added — the
    // serverless Turso cache kept serving the 48-h-truncated payload
    // for up to 4 hours otherwise.
    v: CACHE_KEY_VERSION,
  })

  const res = await fetchWithTimeout(`/api/forecast?${params}`, { signal, timeoutMs: 20_000 })
  if (!res.ok) throw new Error(`Forecast API error: ${res.status}`)
  const data = await res.json()

  // The /api/forecast route sets X-Forecast-Fetched-At so we can surface
  // data freshness to the UI and drive the >4h auto-refresh. We fall back
  // to "now" when the header is absent (SSR or older caches, or older
  // unit-test mocks that only stub `json()` without a Headers object).
  const headers = typeof res.headers?.get === 'function' ? res.headers : null
  const headerFetchedAt = headers?.get('X-Forecast-Fetched-At') ?? null
  const headerFetchedAtMs = headerFetchedAt !== null ? Number(headerFetchedAt) : NaN
  const fetchedAt = Number.isFinite(headerFetchedAtMs) ? headerFetchedAtMs : Date.now()

  const timeStrings = data.hourly.time as string[]
  const time = parseOpenMeteoTimes(timeStrings)
  const series: Record<string, Record<string, (number | null)[]>> = {}

  for (const model of capped) {
    series[model.id] = {}
    for (const metric of metrics) {
      const key = `${metric.hourlyParam}_${model.id}`
      const arr = data.hourly[key]
      // Visibility comes back in metres from Open-Meteo; normalize once
      // here to km so every consumer (table, chart, CSV, map) reads the
      // same unit. Previously the model was advertised as `km` but the
      // raw value flowed through unmodified, so 10 000 m rendered/exported
      // as 10 000 km.
      if (metric.id === 'visibility' && Array.isArray(arr)) {
        series[model.id][metric.id] = arr.map((v: number | null) =>
          v === null || v === undefined ? null : v / 1000)
      } else {
        series[model.id][metric.id] = arr ?? null
      }
    }
    series[model.id]['wind_direction'] = data.hourly[`wind_direction_10m_${model.id}`] ?? null
  }

  if (includeMarine) {
    const marineDays = computeMarineDays(forecastDays * 24)
    try {
      const marine = await fetchMarine(lat, lon, metrics, marineDays, signal)
      const marineLen = marine.timeStrings.length
      if (marineLen > 0) {
        const landHourIndex = new Map<number, number>()
        for (let i = 0; i < time.length; i++) {
          landHourIndex.set(Math.floor(time[i].getTime() / 3600000), i)
        }
        // Align marine data by canonical hour key so it works even when
        // the marine API uses a different timezone than the land API
        // (e.g. marine may return UTC while land returns local time).
        // If no marine timestamp aligns with the land series (e.g. the
        // two APIs were queried across a DST / instant boundary), skip
        // merging for that metric so we don't silently broadcast nulls.
        for (const [metricId, values] of Object.entries(marine.series.marine_global)) {
          const aligned = new Array(timeStrings.length).fill(null) as (number | null)[]
          let matched = 0
          for (let j = 0; j < marineLen; j++) {
            const hourKey = Math.floor(marine.time[j].getTime() / 3600000)
            const idx = landHourIndex.get(hourKey)
            if (idx !== undefined) {
              aligned[idx] = values[j]
              matched++
            }
          }
          if (matched > 0) {
            series.marine_global = series.marine_global ?? {}
            series.marine_global[metricId] = aligned
          }
        }
      }
    } catch (err) {
      console.warn('[Marine] fetch failed', err)
    }
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
 * Dedicated "live UV" fetch. Single lightweight request (`current=uv_index`).
 * Kept separate from the ensemble forecast so the live card reflects the
 * actual provider reading (15-min interval) instead of the floored hourly
 * ensemble value.
 */
export async function fetchCurrentUv(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<CurrentConditions> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    current: 'uv_index',
    timezone: 'auto',
  })
  const res = await fetchWithTimeout(`/api/forecast?${params}`, { signal, timeoutMs: 10_000 })
  if (!res.ok) {
    return { uvIndex: null, uvIndexValidAt: null, uvIndexIntervalSec: null, hasCurrent: false }
  }
  const data = await res.json()
  const current = data?.current
  if (!current || current.uv_index == null) {
    return { uvIndex: null, uvIndexValidAt: null, uvIndexIntervalSec: null, hasCurrent: false }
  }
  const validAt = typeof current.time === 'string' ? new Date(current.time) : null
  const intervalSec = Number.isFinite(current.interval) ? Number(current.interval) : null
  return {
    uvIndex: Number(current.uv_index),
    uvIndexValidAt: validAt instanceof Date && !Number.isNaN(validAt.getTime()) ? validAt : null,
    uvIndexIntervalSec: intervalSec,
    hasCurrent: true,
  }
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
    // past_days=1 makes the grid cover "yesterday → horizon" so the
    // MapPicker can anchor the painted cell to the same UTC-fake-local
    // timestamp the main forecast uses, instead of guessing on absolute
    // hours.
    past_days: '1',
    timezone: 'auto',
  })

  const res = await fetchWithTimeout(`/api/forecast?${params}`, { signal, timeoutMs: 25_000 })
  if (!res.ok) throw new Error(`Heatmap API error: ${res.status}`)
  const data = await res.json()

  const points: { hourly?: Record<string, (number | null)[] | string[]> }[] = Array.isArray(data) ? data : [data]

  const firstWithTime = points.find(p => Array.isArray(p?.hourly?.time))
  // Use `parseOpenMeteoTime` (not `new Date(t)`) so the grid honours
  // the same UTC-fake-local trick as the rest of the app. Without it,
  // non-standard offsets like IST +05:30 / NPT +05:45 misalign the
  // painted cell vs the daily summary.
  const times: Date[] = firstWithTime && Array.isArray(firstWithTime.hourly?.time)
    ? parseOpenMeteoTimes(firstWithTime.hourly!.time as string[])
    : []


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

import type { WeatherModel, Metric } from './models'
import { fetchWithTimeout } from './fetchWithTimeout'
import { fetchMarine, computeMarineDays } from './marine'
import { parseOpenMeteoTimes, getLocationNow } from './dateUtils'
import { selectModelsForLocation } from './regionDetection'
import { weightedAvg } from './ensemble'
import { detectModelsWithNoData } from './api/openMeteoProxy'

// v4-mixed-models: the previous cap of 10 dropped European regional
// models once `selectModelsForLocation` returned 15 candidates
// (7 regionals + 5 globals + 3 AI). 16 covers the worst-case regional
// set (Europe) plus headroom so every selectable model is actually
// fetched and can contribute to the ensemble.
const MAX_FORECAST_MODELS = 16

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
  /** Fetched-at timestamp (ms since epoch). Used to drive the 2h
   *  auto-refresh and surface data freshness in the UI. */
  fetchedAt: number
  /** Daily accumulated precipitation (mm/day). One entry per day, aligned
   *  with the hourly series by index modulo 24. `null` when the provider
   *  didn't return a `daily` block (e.g. when only a single day was
   *  requested). Consumed by `AirConditionsGrid` in S10 to surface the
   *  "Total rain today" cell. */
  dailyPrecipitationSum: (number | null)[]
  /** Daily peak of `precipitation_probability` (%). Same alignment as
   *  `dailyPrecipitationSum`. Used by `DailySummary` to display
   *  "X% prob. lluvia" without doing a manual `Math.max` over 24 entries. */
  dailyPrecipitationProbabilityMax: (number | null)[]
  /** Daily `time[]` array — these are the local-time 00:00 timestamps
   *  used to label the columns. */
  dailyTime: Date[]
  /** Daily counter for hours with measurable precipitation
   *  (hours of rain). */
  dailyPrecipitationHours: (number | null)[]
  /** B-NEW-41: requested models whose payload came back entirely null.
   *  The provider currently serves some catalogue entries (aifs025,
   *  graphcast025 on 2026-08-22) as empty rows; the ensemble skips
   *  them automatically, but exposing the list lets the UI/debug
   *  explain why a model column is all dashes. */
  modelsWithNoData: string[]
  /** B-NBT-15: timestamp (ms) de la puesta de sol de HOY en la
   *  ubicación consultada. Null si el provider no la devuelve. */
  todaySunsetTs: number | null
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

/**
 * B-NEW-41: with a multi-model request (`models=a,b,c`) Open-Meteo
 * returns every DAILY variable keyed per model — e.g.
 * `precipitation_sum_ecmwf_ifs` — instead of a plain
 * `precipitation_sum`. The previous parser read only the unsuffixed
 * key, so `dailyPrecipitationSum` / `precipitation_hours` /
 * `precipitation_probability_max` were silently empty and the
 * "Total lluvia hoy" tile rendered null for weeks. This helper
 * aggregates the suffixed series across contributing models using
 * each model's static weight (the same weighting philosophy as the
 * hourly ensemble), tolerating ragged arrays: some models return an
 * empty array or a shorter one, in which case they simply don't
 * contribute to those rows. Falls back to the unsuffixed key when no
 * suffixed key exists (single-model responses).
 */
export function aggregateDailySeries(
  daily: Record<string, unknown>,
  variable: string,
  models: WeatherModel[],
): (number | null)[] {
  const perModel: { arr: (number | null)[]; weight: number }[] = []
  let maxLen = 0
  for (const m of models) {
    const raw = daily[`${variable}_${m.id}`]
    if (!Array.isArray(raw)) continue
    const arr = raw.map((v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? v : null)
    if (arr.length === 0) continue
    perModel.push({ arr, weight: m.weight > 0 ? m.weight : 1 })
    if (arr.length > maxLen) maxLen = arr.length
  }
  if (perModel.length === 0) {
    // Single-model / best-match responses keep the plain key.
    const plain = daily[variable]
    if (!Array.isArray(plain)) return []
    return plain.map((v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? v : null)
  }
  const weights = perModel.map(p => p.weight)
  const out: (number | null)[] = []
  for (let i = 0; i < maxLen; i++) {
    const vals = perModel.map(p => (i < p.arr.length ? p.arr[i] : null))
    out.push(weightedAvg(vals, weights))
  }
  return out
}

/**
 * B-NEW-41: detect requested models whose entire payload is empty.
 * Implementation lives in `lib/api/openMeteoProxy.ts` so the server
 * route can reuse it for the `X-Forecast-Models-Empty` header without
 * importing the whole client fetch module.
 */
export { detectModelsWithNoData } from './api/openMeteoProxy'

/**
 * B-NBT-9 (2026-08-22): `AirConditionsGrid` renders "Total lluvia hoy"
 * from `dailyPrecipitationSum[0]`. The raw array is aligned with
 * `dailyTime`, which starts `past_days` days ago — index 0 therefore
 * pointed 2-3 days BEFORE today. Rotate so index 0 is always the
 * location's current local day, falling back to the raw array when the
 * day can't be located.
 *
 * Snapshots persisted by pre-B-NEW-41 builds lack `dailyTime` entirely;
 * those are returned as-is (the tile then shows the unrotated value)
 * instead of throwing inside a render-path useMemo — hydrating such a
 * snapshot used to white-screen the whole offline/error fallback.
 */
export function rotateDailyToToday(data: ForecastResult | null): (number | null)[] {
  const arr = data?.dailyPrecipitationSum
  if (!arr || arr.length === 0) return arr ?? []
  if (!Array.isArray(data.dailyTime)) return arr
  const nowLocal = getLocationNow(data.utcOffsetSeconds)
  const key = `${nowLocal.getUTCFullYear()}-${nowLocal.getUTCMonth()}-${nowLocal.getUTCDate()}`
  for (let i = 0; i < data.dailyTime.length; i++) {
    const t = data.dailyTime[i]
    if (!(t instanceof Date)) continue
    const k = `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`
    if (k === key) return arr.slice(i)
  }
  return arr
}

// B-NBT-9c: hoisted to module scope (it used to be re-created inside
// fetchForecast on every call). Bump this whenever the model-selection
// logic or any other request-shaping parameter changes: the value is
// part of the server cache key, so a bump invalidates every prior
// entry in one shot without admin intervention. The route strips `v`
// before forwarding to Open-Meteo.
const CACHE_KEY_VERSION = 'v4-mixed-models-2026-08-22'

/** B-NBT-15: extrae el timestamp de la puesta de sol de HOY desde el
 *  bloque daily.sunset del provider (ISO strings en hora local). */
function parseTodaySunset(daily: Record<string, unknown> | undefined): number | null {
  if (!daily) return null
  const arr = daily.sunset
  if (!Array.isArray(arr)) return null
  const now = Date.now()
  // Devolver el primer sunset cuyo día sea hoy o mañana (los ISO sin
  // offset son hora local — tratarlos como UTC-fake-local). El primer
  // bucle era código muerto (siempre continuaba) y se eliminó (F4).
  for (const s of arr) {
    if (typeof s !== 'string') continue
    const ts = new Date(s + 'Z').getTime()
    if (Number.isFinite(ts) && ts > now - 12 * 3600_000) return ts
  }
  return null
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
  // B-NEW-41 (2026-08-22): the previous build restricted the request to
  // long-range models (maxHours >= 336) because we believed Open-Meteo
  // truncated every per-model series to the shortest requested model's
  // horizon when mixing short-range regionals with long-range globals.
  // Live verification against the provider (2026-08-22, Badalona +
  // Berlin, forecast_days=16 & past_days=3) shows that behaviour no
  // longer exists: each model returns a full-length array null-padded
  // past its own horizon (arome_france_hd → h~128, icon_eu → h~194,
  // ecmwf_ifs → h~422, gfs_global → h455), and `weightedAvg` already
  // skips null entries. The restriction silently removed every
  // high-resolution regional model (AROME-FR HD 1.3km, ICON-D2 2km,
  // ICON-EU, ARPEGE-EU...) from the ensemble, which collapsed the
  // short-lead temperature/precipitation forecast onto coarse globals —
  // the regression the user reported. We restore the mixed selection:
  // regionals first (highest resolution for the location), then
  // globals + AI by weight, capped so a pathological catalogue can't
  // blow up the payload. `capModels` re-sorts by weight DESC and, when
  // `forecastDays` is given, appends any long-range model not already
  // picked so far horizons keep at least one full-coverage model.
  const sorted = [...regionSelected].sort((a, b) => b.weight - a.weight)
  const capped = capModels(sorted, MAX_FORECAST_MODELS, forecastDays)
  const modelIds = capped.map(m => m.id).join(',')
  // Only send land metrics to the forecast API. Marine metrics are
  // fetched separately via fetchMarine and merged in later.
  const hourlyList = metrics.filter(m => m.group === 'land').map(m => m.hourlyParam)
  // Always fetch wind direction so insights can render a direction arrow.
  if (!hourlyList.includes('wind_direction_10m')) hourlyList.push('wind_direction_10m')

  // Sprint 10 / B-10-5 (E3): the request payload carries 3 past days
  // even though the consumer slices the array to start at the current
  // local hour. For short forecasts (â‰¤ 7 days) we already have today's
  // 00:00 in the future forecast, so 1 past day is enough to bridge
  // the overnight gap. For longer forecasts we keep the 3-day tail.
  const pastDays = forecastDays <= 7 ? '1' : '3'

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: hourlyList.join(','),
    // Daily aggregates surfaced by the dashboard in S10. `precipitation_sum`
    // is the actual accumulated mm/day (vs the mm/h hourly series that
    // `CurrentWeatherCard` previously displayed as "total"); `*_max` lets
    // us show the daily peak probability of precipitation without
    // re-deriving it from the hourly stream.
    daily: 'precipitation_sum,precipitation_hours,precipitation_probability_max,sunset',
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
  // data freshness to the UI and drive the >2h auto-refresh. We fall back
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

  // The daily block is optional in the response — older provider
  // versions or single-day requests omit it. Fall back to empty arrays
  // so callers can still index into them without runtime guards.
  // B-NEW-41: with `models=` the provider keys every daily variable per
  // model (`precipitation_sum_ecmwf_ifs`, ...). `aggregateDailySeries`
  // re-assembles a single weighted series across contributing models;
  // the old unsuffixed read left these arrays permanently empty.
  const daily = (data.daily ?? {}) as Record<string, unknown>
  const dailyTimeStrings: string[] = Array.isArray(daily.time) ? (daily.time as string[]) : []
  const dailyTime = parseOpenMeteoTimes(dailyTimeStrings)
  const modelsWithNoData = detectModelsWithNoData(data, capped.map(m => m.id))
  if (modelsWithNoData.length > 0) {
    console.warn(
      `[openMeteo] provider returned all-null payload for model(s): ${modelsWithNoData.join(', ')}; ` +
      'the ensemble renormalizes onto the remaining models'
    )
  }

  return {
    time,
    timeStrings,
    series,
    utcOffsetSeconds: data.utc_offset_seconds ?? 0,
    fetchedAt,
    dailyPrecipitationSum: aggregateDailySeries(daily, 'precipitation_sum', capped),
    dailyPrecipitationProbabilityMax: aggregateDailySeries(daily, 'precipitation_probability_max', capped),
    dailyTime,
    dailyPrecipitationHours: aggregateDailySeries(daily, 'precipitation_hours', capped),
    modelsWithNoData,
    todaySunsetTs: parseTodaySunset(data.daily),
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


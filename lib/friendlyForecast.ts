import type { WeatherModel, MetricId } from './models'
import { pickWeatherIcon, type WeatherIconId } from './weatherIcon'
import {
  resolveActiveModels,
  weightsFor,
  meanAtHour,
  type EnsembleMode,
  type SeriesBag,
} from './ensemble/central'

export type { SeriesBag }

/**
 * Mean of a single metric at a single hour.
 *
 * `mode` controls which models participate:
 *   - `mode === 'wedai'`            → all non-marine models
 *   - `mode === 'models'`           → only `selectedIds`
 *   - `selectedIds` is ignored when mode is 'wedai'.
 *
 * The function is a thin wrapper over the central module so all
 * call sites converge on one code path.
 *
 * B-NEW-5 (2026-07-24): when the user has selected a model set that
 * returns null for a given hour (typically because they deselected
 * the long-range models that the production API now requests, so
 * the only models with data at that lead time are not in their
 * `selectedIds`), fall back to the full WedAI ensemble. The friendly
 * cards (Previsión de hoy, Resumen diario, Próximos días) should
 * never show em-dashes when at least one model has a value for the
 * hour — those cards are a "best estimate" overview, not the
 * comparison surface where the user's manual pick matters. The
 * comparison surface (Insights table, Model chart) still respects
 * the selection literally.
 */
function meanAcrossModels(
  bag: SeriesBag,
  metric: MetricId,
  index: number,
  models: WeatherModel[],
  selectedIds: string[],
  mode: EnsembleMode,
  leadTimeHours: number = 0
): number | null {
  const active = resolveActiveModels(models, selectedIds, mode)
  if (active.length === 0) {
    return fallbackToWedai(bag, metric, index, models, leadTimeHours)
  }
  const weights = weightsFor(metric, leadTimeHours, 1, active)
  const v = meanAtHour(bag, metric, index, active, weights)
  if (v !== null) return v
  // B-NEW-5: user's selection returned no data for this hour —
  // surface the WedAI value instead of an em-dash. We only do this
  // for the friendly helper layer; the chart / InsightsTable call
  // site uses `meanAtHour` directly and respects the literal
  // selection (so the user can still see "no model I selected has
  // data" if that's the point they want to inspect).
  if (mode === 'models') {
    return fallbackToWedai(bag, metric, index, models, leadTimeHours)
  }
  return null
}

function fallbackToWedai(
  bag: SeriesBag,
  metric: MetricId,
  index: number,
  models: WeatherModel[],
  leadTimeHours: number
): number | null {
  const wedai = resolveActiveModels(models, [], 'wedai')
  if (wedai.length === 0) return null
  const weights = weightsFor(metric, leadTimeHours, 1, wedai)
  return meanAtHour(bag, metric, index, wedai, weights)
}

/**
 * Read a metric from every model in bag.series that has it and return the
 * simple average (equal weight). Used for UV which may only be available
 * on global models (GFS, ECMWF) that aren't in the active set.
 */
function allModelAverage(bag: SeriesBag, metric: string, index: number): number | null {
  const ids = Object.keys(bag.series)
  let sum = 0, count = 0
  for (const id of ids) {
    const v = bag.series[id]?.[metric]?.[index]
    if (v !== null && v !== undefined) {
      sum += v
      count++
    }
  }
  return count > 0 ? sum / count : null
}

export interface CurrentSnapshot {
  temperatureC: number | null
  feelsLikeC: number | null
  windKmh: number | null
  windGustsKmh: number | null
  precipitationMm: number | null
  chanceOfRainPct: number | null
  uvIndex: number | null
  uvIndexPeak: number | null
  cloudCoverPct: number | null
  humidityPct: number | null
  icon: WeatherIconId
  conditionLabel: string
  dailyHighC: number | null
  dailyLowC: number | null
}

/**
 * Map a raw precipitation value (mm/h) into a 0-100 "rain intensity" indicator.
 * This used to be labelled in the UI as "probabilidad de lluvia" and was a
 * pure heuristic that could produce values >100 % for >1.25 mm/h. We now
 * clamp + cap and render it as an intensity indicator (with fallback name
 * "chanceOfRainPct" preserved for backwards compatibility with i18n/UI).
 *
 * Prefer the calibrated `precipitation_probability` series when available;
 * only fall back to the heuristic when every model returned null for that
 * hour (which happens during degraded data windows).
 */
function precipChanceFromIntensity(precipMm: number | null): number | null {
  if (precipMm === null) return null
  if (precipMm <= 0) return 0
  if (precipMm >= 2) return 100
  const pct = Math.round(precipMm * 80)
  return Math.max(0, Math.min(100, pct))
}

function ensembleProbability(bag: SeriesBag, hourIndex: number, fallback: number | null): number | null {
  let sum = 0
  let count = 0
  for (const id of Object.keys(bag.series)) {
    if (id === 'marine_global') continue
    const arr = bag.series[id]?.['precipitation_probability']
    const v = arr?.[hourIndex]
    if (typeof v !== 'number' || Number.isNaN(v)) continue
    sum += v
    count += 1
  }
  if (count === 0) return fallback
  return Math.max(0, Math.min(100, Math.round(sum / count)))
}

const CONDITION_KEY: Record<WeatherIconId, 'conditionSunny' | 'conditionPartly' | 'conditionCloudy' | 'conditionRainy' | 'conditionStormy' | 'conditionSnowy'> = {
  sunny: 'conditionSunny',
  partly: 'conditionPartly',
  cloudy: 'conditionCloudy',
  rainy: 'conditionRainy',
  stormy: 'conditionStormy',
  snowy: 'conditionSnowy',
}

/**
 * Approximate "feels like" temperature using the simple wind-chill / heat-index
 * blend. Used as a fallback when the API doesn't return an apparent_temperature
 * field. The blend is intentionally conservative — it only diverges from the
 * actual reading in the obvious edge cases.
 */
function feelsLike(tempC: number | null, windKmh: number | null, humidityPct: number | null): number | null {
  if (tempC === null) return null
  if (tempC <= 10 && windKmh !== null) {
    const v = Math.pow(windKmh, 0.16)
    return Math.round((13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v) * 10) / 10
  }
  if (tempC >= 27 && humidityPct !== null && humidityPct >= 40) {
    const HI = -8.78469475556 + 1.61139411 * tempC + 2.33854883889 * humidityPct
      - 0.14611605 * tempC * humidityPct - 0.012308094 * tempC * tempC
      - 0.0164248277778 * humidityPct * humidityPct
      + 0.002211732 * tempC * tempC * humidityPct
      + 0.00072546 * tempC * humidityPct * humidityPct
      - 0.000003582 * tempC * tempC * humidityPct * humidityPct
    return Math.round(HI * 10) / 10
  }
  return tempC
}

/**
 * Maximum UV index across the entire UTC-fake-local *current calendar day*
 * (00:00 → 23:00). Powers the "UV peak" reading shown next to the current UV
 * in the metrics card so the value stays meaningful at night and during the
 * early morning when the raw current UV is 0.
 */
function dailyUvPeak(bag: SeriesBag, nowIndex: number): number | null {
  const t = bag.time[nowIndex]
  if (!(t instanceof Date)) return null
  const dayKey = `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`
  let peak: number | null = null
  for (let i = 0; i < bag.time.length; i++) {
    const ti = bag.time[i]
    if (!(ti instanceof Date)) continue
    if (`${ti.getUTCFullYear()}-${ti.getUTCMonth()}-${ti.getUTCDate()}` !== dayKey) continue
    const v = allModelAverage(bag, 'uv_index', i)
    if (v === null) continue
    if (peak === null || v > peak) peak = v
  }
  return peak
}

export function computeCurrentSnapshot(
  bag: SeriesBag,
  models: WeatherModel[],
  activeIds: string[],
  hourIndex: number,
  /** When non-null, used in place of the hourly-ensemble average for the
   *  "live" UV card. The provider's `current=uv_index` is updated at ~15 min
   *  cadence; the ensemble hourly floored value can lag by up to one hour. */
  liveUvOverride: number | null = null
): CurrentSnapshot | null {
  if (!bag.time[hourIndex]) return null
  // Sprint 10 / B-10-1: the "current hour" snapshot is always the
  // best ensemble (WedAI) regardless of which models the user has
  // toggled in Models mode. The big "Tiempo actual" card and the
  // "AHORA" slot of the hourly strip must agree with the InsightsTable
  // active row, which also uses WedAI for the current hour.
  const mode: EnsembleMode = 'wedai'
  const temp = meanAcrossModels(bag, 'temperature', hourIndex, models, activeIds, mode)
  const wind = meanAcrossModels(bag, 'wind_speed', hourIndex, models, activeIds, mode)
  const gusts = meanAcrossModels(bag, 'wind_gusts', hourIndex, models, activeIds, mode)
  const precip = meanAcrossModels(bag, 'precipitation', hourIndex, models, activeIds, mode)
  const uvHourly = allModelAverage(bag, 'uv_index', hourIndex)
  const uv = liveUvOverride ?? uvHourly
  const cloud = meanAcrossModels(bag, 'cloud_cover', hourIndex, models, activeIds, mode)
  const humidity = meanAcrossModels(bag, 'humidity', hourIndex, models, activeIds, mode)
  const peak = dailyUvPeak(bag, hourIndex)
  // Prefer the calibrated `precipitation_probability` series from the
  // provider. If every model returned null we degrade to the intensity
  // heuristic so the UI never goes blank.
  const rainProbability = ensembleProbability(bag, hourIndex, precipChanceFromIntensity(precip))

  let dailyHigh: number | null = null
  let dailyLow: number | null = null
  const t = bag.time[hourIndex]
  if (t instanceof Date) {
    const dayKey = `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`
    // Scan the full day from start (00:00) to end (23:59) so the daily
    // high/low reflects morning temperatures too, not just from hourIndex.
    let dayStart = hourIndex
    while (dayStart > 0) {
      const prev = bag.time[dayStart - 1]
      if (!(prev instanceof Date)) break
      if (`${prev.getUTCFullYear()}-${prev.getUTCMonth()}-${prev.getUTCDate()}` !== dayKey) break
      dayStart--
    }
    for (let i = dayStart; i < bag.time.length; i++) {
      const ti = bag.time[i]
      if (!(ti instanceof Date)) continue
      if (`${ti.getUTCFullYear()}-${ti.getUTCMonth()}-${ti.getUTCDate()}` !== dayKey) break
      const tv = meanAcrossModels(bag, 'temperature', i, models, activeIds, mode)
      if (tv === null) continue
      if (dailyHigh === null || tv > dailyHigh) dailyHigh = tv
      if (dailyLow === null || tv < dailyLow) dailyLow = tv
    }
  }

  const icon = pickWeatherIcon({
    cloudCoverPct: cloud,
    precipitationMmDay: precip,
    windGustsKmh: gusts,
    minTempC: dailyLow,
  })

  return {
    temperatureC: temp,
    feelsLikeC: feelsLike(temp, gusts ?? wind, humidity),
    windKmh: wind,
    windGustsKmh: gusts,
    precipitationMm: precip,
    chanceOfRainPct: rainProbability,
    uvIndex: uv,
    uvIndexPeak: peak,
    cloudCoverPct: cloud,
    humidityPct: humidity,
    icon,
    conditionLabel: CONDITION_KEY[icon],
    dailyHighC: dailyHigh,
    dailyLowC: dailyLow,
  }
}

export interface HourlySlot {
  index: number
  hourLabel: string
  icon: WeatherIconId
  tempC: number | null
  precipMm: number | null
  isPast: boolean
}

function formatBlockLabel(hour: number, locale: 'en' | 'es'): string {
  const hh = ((hour % 24) + 24) % 24
  if (locale === 'en') {
    const period = hh >= 12 ? 'PM' : 'AM'
    const hour12 = hh % 12 === 0 ? 12 : hh % 12
    return `${hour12} ${period}`
  }
  return `${hh}h`
}

/**
 * Build today's six 4-hour slots anchored at 00:00 local time, e.g. for a
 * forecast at 14:30 we render 00, 04, 08, 12, 16, 20; the slot whose 4-hour
 * block contains the current time is labelled "Now" instead of its hour.
 *
 * `bag.time` is expected to span past_days + today + forecast_days so that
 * today’s 00:00 is reachable. For any past slot whose data is unavailable
 * in the underlying API response we still emit the slot with `tempC=null`
 * so the UI can render an em-dash instead of guessing.
 */
export function computeHourlySlots(
  bag: SeriesBag,
  models: WeatherModel[],
  activeIds: string[],
  nowIndex: number,
  locale: 'en' | 'es',
  count = 7,
  intervalHours = 4,
  /** When false, the "Ahora" / "Now" label is suppressed (used when the
   *  caller has selected a future day via the day chips). Defaults to true
   *  for backward compatibility. */
  isViewingToday = true,
  /** B-NEW-10 (2026-07-25): ensemble mode for the future slots (1..count-1).
   *  Defaults to `'models'` to preserve the previous behaviour where the
   *  hourly strip respected the user's selection. When the user flips the
   *  Avanzado toggle to WedAI, the caller passes `'wedai'` so the future
   *  slots also use the calibrated full ensemble — otherwise selecting a
   *  single model in Models mode would leak into the friendly card even
   *  after the user clicked WedAI (the B-NEW-10 bug). The AHORA slot
   *  always uses WedAI (nowMode='wedai' below) regardless of this arg. */
  mode: EnsembleMode = 'models'
): HourlySlot[] {
  const out: HourlySlot[] = []
  if (!bag.time[nowIndex]) return out
  const nowT = bag.time[nowIndex]
  if (!(nowT instanceof Date)) return out

  // The strip is "Ahora + 6 saltos de 4h, aunque pase al día siguiente" — i.e.
  // a forward-looking forecast of the next ~24 h. Slots are anchored to the
  // 4-hour block that contains the selected hour (nowIndex) and the next
  // blocks every `intervalHours` hours, regardless of which calendar day
  // they fall on.
  //
  // When `isViewingToday` is false the caller is anchoring on a *future*
  // day (e.g. via the day chips) and the "Ahora" label is misleading, so
  // we always render a plain hour-of-day label instead.

  // Find the index of the 4h block that contains the current selection.
  const selectedHour = nowT.getUTCHours()
  const blockStartHour = Math.floor(selectedHour / intervalHours) * intervalHours
  const blockDayKey = `${nowT.getUTCFullYear()}-${nowT.getUTCMonth()}-${nowT.getUTCDate()}`

  // Walk time[] looking for the first entry whose hour matches blockStartHour
  // AND whose day matches blockDayKey. That is the "now slot" anchor.
  let startIdx = -1
  for (let i = 0; i < bag.time.length; i++) {
    const t = bag.time[i]
    if (!(t instanceof Date)) continue
    if (t.getUTCHours() !== blockStartHour) continue
    if (`${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}` !== blockDayKey) continue
    startIdx = i
    break
  }
  if (startIdx === -1) return out

  // Slot 0: "Ahora" uses the exact current temperature at nowIndex.
  // Sprint 10 / B-10-1: AHORA must use WedAI (best ensemble) so the
  // value agrees with the "Tiempo actual" card and the InsightsTable
  // active row. Future slots (1..count-1) still respect the user's
  // selectedIds so they reflect their manual model choice.
  const nowTdata = bag.time[nowIndex]
  const nowMode: EnsembleMode = 'wedai'
  const nowTemp = meanAcrossModels(bag, 'temperature', nowIndex, models, activeIds, nowMode)
  const nowPrecip = meanAcrossModels(bag, 'precipitation', nowIndex, models, activeIds, nowMode)
  const nowCloud = meanAcrossModels(bag, 'cloud_cover', nowIndex, models, activeIds, nowMode)
  const nowGusts = meanAcrossModels(bag, 'wind_gusts', nowIndex, models, activeIds, nowMode)
  const nowIcon = pickWeatherIcon({
    cloudCoverPct: nowCloud, precipitationMmDay: nowPrecip,
    windGustsKmh: nowGusts, minTempC: nowTemp,
  })
  out.push({
    index: nowIndex,
    // The slot covers the entire 4h block, so its label is the block
    // start hour (e.g. 12h for a 12:00–16:00 block). Labelling it by
    // the exact selected hour mismatched the visual block size in the
    // UI when isViewingToday was false — which is exactly the test the
    // suite was catching.
    hourLabel: isViewingToday
      ? (locale === 'en' ? 'Now' : 'Ahora')
      : formatBlockLabel(blockStartHour, locale),
    icon: nowIcon, tempC: nowTemp, precipMm: nowPrecip, isPast: false,
  })

  // Slots 1…count-1: 4-hour blocks anchored at blockStartHour.
  // The mode for these slots is now driven by the `mode` parameter
  // (B-NEW-10): when the Avanzado toggle is on WedAI, the caller
  // passes 'wedai' and the future slots use the calibrated full
  // ensemble too. Otherwise we keep the previous "respect the
  // user's selection" behaviour.
  const futureMode: EnsembleMode = mode
  for (let i = 1; i < count; i++) {
    const idx = startIdx + i * intervalHours
    if (idx >= bag.time.length) break
    const t = bag.time[idx]
    if (!(t instanceof Date)) break

    const temp = meanAcrossModels(bag, 'temperature', idx, models, activeIds, futureMode)
    const precip = meanAcrossModels(bag, 'precipitation', idx, models, activeIds, futureMode)
    const cloud = meanAcrossModels(bag, 'cloud_cover', idx, models, activeIds, futureMode)
    const gusts = meanAcrossModels(bag, 'wind_gusts', idx, models, activeIds, futureMode)

    const icon = pickWeatherIcon({
      cloudCoverPct: cloud, precipitationMmDay: precip,
      windGustsKmh: gusts, minTempC: temp,
    })

    const isPast = isViewingToday && idx < nowIndex
    out.push({ index: idx, hourLabel: formatBlockLabel(t.getUTCHours(), locale), icon, tempC: temp, precipMm: precip, isPast })
  }

  return out
}

export interface DaySummary {
  label: string
  fullDate: string
  highC: number | null
  lowC: number | null
  icon: WeatherIconId
  precipMm: number | null
  /** Absolute index in `bag.time` of the 12:00 slot for this day, if it
   *  exists inside the requested window. The caller subtracts `nowIndex`
   *  to convert this into a view-relative hour offset for the slider. */
  noonIndex: number
}

/**
 * Build up to `count` day buckets (7 or 14) starting from the *current* day
 * (i.e. the bucket containing `nowIndex`). Powers the right-sidebar week /
 * fortnight panel.
 */
export function computeWeekSummaries(
  bag: SeriesBag,
  models: WeatherModel[],
  activeIds: string[],
  nowIndex: number,
  maxHours: number,
  locale: 'en' | 'es',
  count: 7 | 14 = 7,
  /** B-NEW-10 (2026-07-25): ensemble mode for the future day buckets.
   *  Defaults to `'models'` to preserve the previous behaviour where the
   *  right-sidebar Próximos días panel respected the user's selection.
   *  When the user flips the Avanzado toggle to WedAI, the caller
   *  passes `'wedai'` so the panel uses the calibrated full ensemble —
   *  otherwise selecting a single model in Models mode would leak into
   *  Próximos días even after the user clicked WedAI. */
  mode: EnsembleMode = 'models'
): DaySummary[] {
  interface Bucket { key: string; dayIdx: number; start: number; end: number }
  const buckets: Bucket[] = []
  let current: Bucket | null = null
  const limit = Math.min(bag.time.length, maxHours)
  // B-NEW-5: when the user's selection is empty, fall back to the
  // full WedAI ensemble so the "Próximos días" sidebar still shows
  // highs/lows. Without this, deselecting every long-range model
  // would leave the right column blank even though several models
  // have data at every hour.
  const activeModels = models.filter(m => activeIds.includes(m.id))
  if (activeModels.length === 0) {
    const wedai = resolveActiveModels(models, [], 'wedai')
    if (wedai.length === 0) return []
    // Synthetic activeIds that includes every WedAI model so the
    // existing loop body keeps working unchanged.
    activeIds = wedai.map(m => m.id)
  }
  for (let i = nowIndex; i < limit; i++) {
    const t = bag.time[i]
    if (!(t instanceof Date)) continue
    const key = `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`
    if (!current || current.key !== key) {
      // Scan backwards to 00:00 of this day so high/low captures
      // morning temperatures for the first day.
      let dayStart = i
      while (dayStart > 0) {
        const prev = bag.time[dayStart - 1]
        if (!(prev instanceof Date)) break
        const prevKey = `${prev.getUTCFullYear()}-${prev.getUTCMonth()}-${prev.getUTCDate()}`
        if (prevKey !== key) break
        dayStart--
      }
      current = { key, dayIdx: t.getUTCDay(), start: dayStart, end: i }
      buckets.push(current)
    } else {
      current.end = i
    }
    if (buckets.length === count) {
      // Drain the rest of the current (last) day before exiting so that
      // the last bucket's max/min include the late-evening hours. Without
      // this we'd break on the day boundary and the 7th/14th day
      // would aggregate only its first hour.
      let endReached = false
      let j = i + 1
      for (; j < limit; j++) {
        const tj = bag.time[j]
        if (!(tj instanceof Date)) break
        const kj = `${tj.getUTCFullYear()}-${tj.getUTCMonth()}-${tj.getUTCDate()}`
        if (kj !== key) {
          endReached = true
          break
        }
        current.end = j
      }
      if (endReached || j >= limit) break
    }
  }

  return buckets.map(b => {
    let high: number | null = null
    let low: number | null = null
    let precip = 0
    let cloudSum = 0
    let cloudCount = 0
    let gustsMax: number | null = null
    let noonIndex = b.start
    // Week summaries aggregate future days, so the mode is driven by
    // the `mode` parameter (B-NEW-10): when the Avanzado toggle is on
    // WedAI, the caller passes 'wedai' and the panel uses the
    // calibrated full ensemble. Otherwise we keep the previous
    // "respect the user's selection" behaviour. The "current hour"
    // override lives in `computeCurrentSnapshot` / InsightsTable.
    const weekMode: EnsembleMode = mode
    for (let i = b.start; i <= b.end; i++) {
      const t = meanAcrossModels(bag, 'temperature', i, models, activeIds, weekMode)
      if (t !== null) {
        if (high === null || t > high) high = t
        if (low === null || t < low) low = t
      }
      const p = meanAcrossModels(bag, 'precipitation', i, models, activeIds, weekMode)
      if (p !== null) precip += p
      const c = meanAcrossModels(bag, 'cloud_cover', i, models, activeIds, weekMode)
      if (c !== null) { cloudSum += c; cloudCount++ }
      const g = meanAcrossModels(bag, 'wind_gusts', i, models, activeIds, weekMode)
      if (g !== null && (gustsMax === null || g > gustsMax)) gustsMax = g
      const ti = bag.time[i]
      if (ti instanceof Date && ti.getUTCHours() === 12) noonIndex = i
    }
    const cloudAvg = cloudCount > 0 ? cloudSum / cloudCount : null
    const icon = pickWeatherIcon({
      cloudCoverPct: cloudAvg,
      precipitationMmDay: precip,
      windGustsKmh: gustsMax,
      minTempC: low,
    })
    return {
      label: locale === 'en'
        ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][b.dayIdx]
        : ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][b.dayIdx],
      fullDate: b.key,
      highC: high,
      lowC: low,
      icon,
      precipMm: precip,
      noonIndex,
    }
  })
}

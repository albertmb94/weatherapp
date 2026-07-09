import type { WeatherModel } from './models'
import { ENSEMBLE_PRESETS, getLeadTimeBucket, METRIC_TO_ENSEMBLE } from './models'
import { weightedAvg } from './ensemble'
import { pickWeatherIcon, type WeatherIconId } from './weatherIcon'

interface SeriesBag {
  time: Date[]
  series: Record<string, Record<string, (number | null)[]>>
}

/**
 * Get the ensemble weight map for a given metric and lead time.
 * Returns the preset weights for the active models, adjusted for the
 * forecast horizon (short-range models get 0 weight at long lead times).
 */
function getWeightsForMetric(
  metric: string,
  activeModels: WeatherModel[],
  leadTimeHours: number = 0
): number[] {
  // Map metric to ensemble preset
  const presetId = METRIC_TO_ENSEMBLE[metric] ?? 'temperature'
  const preset = ENSEMBLE_PRESETS.find(p => p.id === presetId) ?? ENSEMBLE_PRESETS[0]

  // Get the right bucket for this lead time
  const bucket = getLeadTimeBucket(leadTimeHours)
  const bucketWeights = preset.weights[bucket] ?? preset.weights['0-48h']

  // Build weight array matching activeModels order
  return activeModels.map(m => bucketWeights[m.id] ?? 0.01)
}

function meanAcrossModels(
  bag: SeriesBag,
  metric: string,
  index: number,
  models: WeatherModel[],
  activeIds: string[],
  leadTimeHours: number = 0
): number | null {
  const activeModels = models.filter(m => activeIds.includes(m.id))
  if (activeModels.length === 0) return null
  const vals = activeModels.map(m => bag.series[m.id]?.[metric]?.[index] ?? null)
  const weights = getWeightsForMetric(metric, activeModels, leadTimeHours)
  return weightedAvg(vals, weights, null, activeModels.map(m => m.id))
}

/**
 * Aggregate current-hour "now" snapshot from the ensemble. Powers the hero
 * card. All values are weighted averages across the active models at the
 * supplied index.
 */
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
 * Map a raw precipitation value (mm/h) into a "chance of rain" percentage.
 * Calibrated empirically: 1 mm/h ≈ 80 %, 2 mm/h ≈ 95 %, anything below
 * 0.2 mm/h rounds to 0 %.
 */
function precipChance(precipMm: number | null): number | null {
  if (precipMm === null) return null
  if (precipMm <= 0) return 0
  if (precipMm >= 2) return 100
  return Math.round(precipMm * 80)
}

/**
 * Maximum UV index across the entire UTC-fake-local *current calendar day*
 * (00:00 → 23:00). Powers the "UV peak" reading shown next to the current UV
 * in the metrics card so the value stays meaningful at night and during the
 * early morning when the raw current UV is 0.
 */
function dailyUvPeak(bag: SeriesBag, models: WeatherModel[], activeIds: string[], nowIndex: number): number | null {
  const t = bag.time[nowIndex]
  if (!(t instanceof Date)) return null
  const dayKey = `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`
  let peak: number | null = null
  for (let i = 0; i < bag.time.length; i++) {
    const ti = bag.time[i]
    if (!(ti instanceof Date)) continue
    if (`${ti.getUTCFullYear()}-${ti.getUTCMonth()}-${ti.getUTCDate()}` !== dayKey) continue
    const v = meanAcrossModels(bag, 'uv_index', i, models, activeIds)
    if (v === null) continue
    if (peak === null || v > peak) peak = v
  }
  return peak
}

export function computeCurrentSnapshot(
  bag: SeriesBag,
  models: WeatherModel[],
  activeIds: string[],
  hourIndex: number
): CurrentSnapshot | null {
  if (!bag.time[hourIndex]) return null
  const temp = meanAcrossModels(bag, 'temperature', hourIndex, models, activeIds)
  const wind = meanAcrossModels(bag, 'wind_speed', hourIndex, models, activeIds)
  const gusts = meanAcrossModels(bag, 'wind_gusts', hourIndex, models, activeIds)
  const precip = meanAcrossModels(bag, 'precipitation', hourIndex, models, activeIds)
  const uv = meanAcrossModels(bag, 'uv_index', hourIndex, models, activeIds)
  const cloud = meanAcrossModels(bag, 'cloud_cover', hourIndex, models, activeIds)
  const humidity = meanAcrossModels(bag, 'humidity', hourIndex, models, activeIds)
  const peak = dailyUvPeak(bag, models, activeIds, hourIndex)

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
      const tv = meanAcrossModels(bag, 'temperature', i, models, activeIds)
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
    chanceOfRainPct: precipChance(precip),
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
  isViewingToday = true
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

  for (let i = 0; i < count; i++) {
    const idx = startIdx + i * intervalHours
    if (idx >= bag.time.length) break
    const t = bag.time[idx]
    if (!(t instanceof Date)) break

    const temp = meanAcrossModels(bag, 'temperature', idx, models, activeIds)
    const precip = meanAcrossModels(bag, 'precipitation', idx, models, activeIds)
    const cloud = meanAcrossModels(bag, 'cloud_cover', idx, models, activeIds)
    const gusts = meanAcrossModels(bag, 'wind_gusts', idx, models, activeIds)

    const icon = pickWeatherIcon({
      cloudCoverPct: cloud,
      precipitationMmDay: precip,
      windGustsKmh: gusts,
      minTempC: temp,
    })

    let hourLabel: string
    if (i === 0 && isViewingToday) {
      hourLabel = locale === 'en' ? 'Now' : 'Ahora'
    } else {
      hourLabel = formatBlockLabel(t.getUTCHours(), locale)
    }

    const isPast = isViewingToday && idx < nowIndex
    out.push({ index: idx, hourLabel, icon, tempC: temp, precipMm: precip, isPast })
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
  count: 7 | 14 = 7
): DaySummary[] {
  interface Bucket { key: string; dayIdx: number; start: number; end: number }
  const buckets: Bucket[] = []
  let current: Bucket | null = null
  const limit = Math.min(bag.time.length, maxHours)
  const activeModels = models.filter(m => activeIds.includes(m.id))
  if (activeModels.length === 0) return []
  for (let i = nowIndex; i < limit; i++) {
    const t = bag.time[i]
    if (!(t instanceof Date)) continue
    const key = `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`
    if (!current || current.key !== key) {
      current = { key, dayIdx: t.getUTCDay(), start: i, end: i }
      buckets.push(current)
    } else {
      current.end = i
    }
    if (buckets.length === count) break
  }

  return buckets.map(b => {
    let high: number | null = null
    let low: number | null = null
    let precip = 0
    let cloudSum = 0
    let cloudCount = 0
    let gustsMax: number | null = null
    for (let i = b.start; i <= b.end; i++) {
      const t = meanAcrossModels(bag, 'temperature', i, models, activeIds)
      if (t !== null) {
        if (high === null || t > high) high = t
        if (low === null || t < low) low = t
      }
      const p = meanAcrossModels(bag, 'precipitation', i, models, activeIds)
      if (p !== null) precip += p
      const c = meanAcrossModels(bag, 'cloud_cover', i, models, activeIds)
      if (c !== null) { cloudSum += c; cloudCount++ }
      const g = meanAcrossModels(bag, 'wind_gusts', i, models, activeIds)
      if (g !== null && (gustsMax === null || g > gustsMax)) gustsMax = g
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
    }
  })
}

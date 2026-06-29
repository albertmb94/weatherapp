import type { WeatherModel } from './models'
import { weightedAvg } from './ensemble'
import { pickWeatherIcon, type WeatherIconId } from './weatherIcon'

interface SeriesBag {
  time: Date[]
  series: Record<string, Record<string, (number | null)[]>>
}

function meanAcrossModels(
  bag: SeriesBag,
  metric: string,
  index: number,
  models: WeatherModel[],
  activeIds: string[]
): number | null {
  const activeModels = models.filter(m => activeIds.includes(m.id))
  if (activeModels.length === 0) return null
  const vals = activeModels.map(m => bag.series[m.id]?.[metric]?.[index] ?? null)
  return weightedAvg(vals, activeModels.map(m => m.weight))
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

  let dailyHigh: number | null = null
  let dailyLow: number | null = null
  const t = bag.time[hourIndex]
  if (t instanceof Date) {
    const dayKey = `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`
    for (let i = hourIndex; i < bag.time.length; i++) {
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
}

/**
 * Build 24 hourly slots starting at `startIndex`. The caller is expected to
 * pass in the *trimmed* series start (i.e. after current-time slicing).
 */
export function computeHourlySlots(
  bag: SeriesBag,
  models: WeatherModel[],
  activeIds: string[],
  startIndex: number,
  locale: 'en' | 'es',
  count = 24
): HourlySlot[] {
  const out: HourlySlot[] = []
  for (let i = 0; i < count; i++) {
    const idx = startIndex + i
    if (!bag.time[idx]) break
    const t = bag.time[idx]
    const temp = meanAcrossModels(bag, 'temperature', idx, models, activeIds)
    const precip = meanAcrossModels(bag, 'precipitation', idx, models, activeIds)
    const cloud = meanAcrossModels(bag, 'cloud_cover', idx, models, activeIds)
    const gusts = meanAcrossModels(bag, 'wind_gusts', idx, models, activeIds)
    const low = temp !== null ? temp : null
    const icon = pickWeatherIcon({
      cloudCoverPct: cloud,
      precipitationMmDay: precip,
      windGustsKmh: gusts,
      minTempC: low,
    })
    const hour = t instanceof Date
      ? t.toLocaleTimeString(locale === 'en' ? 'en-US' : 'es-ES', {
          timeZone: 'UTC',
          hour: 'numeric',
          hour12: locale === 'en',
        })
      : ''
    out.push({ index: idx, hourLabel: hour, icon, tempC: temp, precipMm: precip })
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
 * Build up to 7 day buckets starting from the *current* day (i.e. the bucket
 * containing `startIndex`), exactly matching the right-sidebar "week" panel.
 */
export function computeWeekSummaries(
  bag: SeriesBag,
  models: WeatherModel[],
  activeIds: string[],
  startIndex: number,
  maxHours: number,
  locale: 'en' | 'es'
): DaySummary[] {
  interface Bucket { key: string; dayIdx: number; start: number; end: number }
  const buckets: Bucket[] = []
  let current: Bucket | null = null
  const limit = Math.min(bag.time.length, maxHours)
  const activeModels = models.filter(m => activeIds.includes(m.id))
  if (activeModels.length === 0) return []
  for (let i = startIndex; i < limit; i++) {
    const t = bag.time[i]
    if (!(t instanceof Date)) continue
    const key = `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`
    if (!current || current.key !== key) {
      current = { key, dayIdx: t.getUTCDay(), start: i, end: i }
      buckets.push(current)
    } else {
      current.end = i
    }
    if (buckets.length === 7) break
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

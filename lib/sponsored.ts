/**
 * B-NBT-13 (2026-08-22): sponsored product matching.
 * Evalua el snapshot contra los triggers del catalogo.
 */
import type { CurrentSnapshot } from './friendlyForecast'

export interface TriggerMatch {
  key: string
  priority: number
}

export function evaluateTriggers(snap: CurrentSnapshot | null): TriggerMatch[] {
  if (!snap) return []
  const matches: TriggerMatch[] = []
  const uv = snap.uvIndex ?? 0
  const uvPeak = snap.uvIndexPeak ?? 0
  if (uv >= 6 || uvPeak >= 8) matches.push({ key: 'uv_high', priority: 1 })
  const rainProb = snap.chanceOfRainPct ?? 0
  const rainMm = snap.precipitationMm ?? 0
  if (rainProb >= 55 || rainMm >= 0.3) matches.push({ key: 'rain_24h', priority: 1 })
  const feel = snap.feelsLikeC ?? snap.temperatureC ?? 0
  if (feel >= 33) matches.push({ key: 'heat', priority: 2 })
  const gusts = snap.windGustsKmh ?? 0
  if (gusts >= 45) matches.push({ key: 'wind_strong', priority: 2 })
  const temp = snap.temperatureC ?? 99
  if (temp <= 2) matches.push({ key: 'frost', priority: 1 })
  if (snap.icon === 'snowy') matches.push({ key: 'snow', priority: 1 })
  return matches.sort((a, b) => a.priority - b.priority)
}

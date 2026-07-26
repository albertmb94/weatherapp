/**
 * Locale-aware formatters shared across the UI.
 *
 * Before S8 these helpers were re-implemented three times
 * (`CurrentWeatherCard`, `AirConditionsGrid`, `HourlyForecastStrip`)
 * and twice in `WeekForecastPanel`. Centralising them here removes the
 * drift (e.g. one version localised "now" while another left it in
 * English) and lets tests pin the formatting rules.
 */

import type { Locale } from './i18n'

export function fmtTemp(value: number | null, locale: Locale, unit: '°C' | '°F' = '°C'): string {
  if (value === null || !Number.isFinite(value)) return '–'
  const rounded = Math.round(value)
  return `${rounded}${unit}`
}

export function fmtPercent(value: number | null, _locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return '–'
  return `${Math.round(value)}%`
}

export function fmtMm(value: number | null, _locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return '–'
  return `${value.toFixed(1)}`
}

export function fmtKmh(value: number | null, _locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return '–'
  return `${Math.round(value)}`
}

export function fmtDistanceKm(value: number | null, _locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return '–'
  return `${Math.round(value)}`
}

const NOW_LABEL: Record<Locale, string> = {
  en: 'now',
  es: 'ahora',
}

/** "now" label localised. Replaces the hard-coded English string in
 *  the S0 baseline that S1's audit flagged. */
export function fmtNow(locale: Locale): string {
  return NOW_LABEL[locale]
}

/**
 * Client-side glue between `ConsultaParams` (from /api/consulta) and the
 * URL state managed by `useUrlState`.
 *
 * Pure and SDK-free on purpose: the mapping is the part worth testing.
 * Decisions made here (confirmed with the product owner):
 *
 *   - `tema` → `metric` (already a `MetricId`, i.e. an allowed metric).
 *   - `horizonteDias` → `range` (clamped to the allowed set) and, for a
 *     week or more, `weekDays`.
 *   - `franja` → a target *local hour*; the caller resolves it to a series
 *     index with `findHourIndexForLocalHour` (the series is only known to
 *     the component that owns the forecast data).
 *   - `bucket` is intentionally NOT touched: it is an aggregation width,
 *     not something a natural-language query expresses.
 */

import type { ConsultaParams, Franja } from './consulta'

/** Patch shape accepted by `useUrlState`'s updater for our fields. */
export interface ConsultaUrlPatch {
  metric?: string
  range?: number
  weekDays?: 7 | 14
}

/** Ranges the URL parser accepts (`lib/useUrlState.ts` ALLOWED_RANGES). */
const ALLOWED_RANGES = [24, 48, 72, 168, 336] as const

/** Smallest allowed range that covers `days`, else the 14-day maximum. */
function rangeForDays(days: number): number {
  const required = days * 24
  return ALLOWED_RANGES.find((r) => r >= required) ?? ALLOWED_RANGES[ALLOWED_RANGES.length - 1]
}

export function consultaParamsToUrlPatch(params: ConsultaParams): ConsultaUrlPatch {
  const patch: ConsultaUrlPatch = { range: rangeForDays(params.horizonteDias) }
  if (params.tema) patch.metric = params.tema
  if (params.horizonteDias >= 14) patch.weekDays = 14
  else if (params.horizonteDias >= 7) patch.weekDays = 7
  return patch
}

/** Representative local hour for each part of the day. `null` = no anchor. */
const FRANJA_HOUR: Record<Franja, number | null> = {
  por_la_manana: 9,
  mediodia: 13,
  tarde: 17,
  noche: 21,
  todo_el_dia: null,
}

export function franjaToLocalHour(franja: Franja): number | null {
  return FRANJA_HOUR[franja] ?? null
}

/**
 * First index in the hourly series whose local hour equals `targetLocalHour`.
 *
 * `times` are "UTC-fake-local" Dates (see `lib/dateUtils.ts`): the location's
 * local wall clock is read with `getUTCHours()`. Returns null when the hour
 * is out of range or absent from the series, so callers can leave the
 * current selection untouched.
 */
export function findHourIndexForLocalHour(
  times: ReadonlyArray<Date>,
  targetLocalHour: number,
): number | null {
  if (!Number.isInteger(targetLocalHour) || targetLocalHour < 0 || targetLocalHour > 23) {
    return null
  }
  for (let i = 0; i < times.length; i++) {
    const t = times[i]
    if (t instanceof Date && t.getUTCHours() === targetLocalHour) return i
  }
  return null
}

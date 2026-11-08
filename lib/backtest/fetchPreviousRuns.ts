/**
 * Fetch historical forecast data from Open-Meteo's Previous Runs API.
 * This provides forecast values at fixed lead-time offsets (1-7 days).
 */

import { fetchWithTimeout } from '@/lib/fetchWithTimeout'
import type { ForecastArchiveRow } from './db'
import { BACKTEST_MODEL_IDS, BACKTEST_METRICS, BACKTEST_METRIC_TO_PARAM, type BacktestLocation } from './config'
import { archiveTime, shiftArchiveHours } from './archiveTime'

const PREVIOUS_RUNS_BASE = 'https://previous-runs-api.open-meteo.com/v1/forecast'

/**
 * Fetch previous-day forecasts for a location and date range.
 * Returns an array of rows ready for DB insertion.
 */
export async function fetchPreviousRuns(
  location: BacktestLocation,
  startDate: string, // YYYY-MM-DD
  endDate: string,   // YYYY-MM-DD
  signal?: AbortSignal,
  options: { metrics?: readonly string[]; modelIds?: readonly string[] } = {},
): Promise<ForecastArchiveRow[]> {
  const rows: ForecastArchiveRow[] = []
  const modelIds = options.modelIds ?? BACKTEST_MODEL_IDS
  const metrics = options.metrics ?? BACKTEST_METRICS
  const models = modelIds.join(',')
  const hourlyParams = metrics.map(m => BACKTEST_METRIC_TO_PARAM[m]).join(',')

  // Build previous-day params: _previous_day1 through _previous_day7
  const previousParams = Array.from({ length: 7 }, (_, i) =>
    metrics.map(m => `${BACKTEST_METRIC_TO_PARAM[m]}_previous_day${i + 1}`).join(',')
  ).join(',')

  const params = new URLSearchParams({
    latitude: location.lat.toString(),
    longitude: location.lon.toString(),
    hourly: `${hourlyParams},${previousParams}`,
    models,
    start_date: startDate,
    end_date: endDate,
    timezone: 'GMT',
    timeformat: 'unixtime',
  })

  const res = await fetchWithTimeout(`${PREVIOUS_RUNS_BASE}?${params}`, {
    signal,
    timeoutMs: 25_000,
  })

  if (!res.ok) {
    throw new Error(`Previous Runs API error: ${res.status}`)
  }

  const data = await res.json()
  const hourly = data.hourly
  if (!hourly?.time) return rows

  const times: (string | number)[] = hourly.time

  for (let i = 0; i < times.length; i++) {
    const validTime = archiveTime(times[i])

    for (const metric of metrics) {
      const param = BACKTEST_METRIC_TO_PARAM[metric]

      // Current forecast (lead time 0): emit a row only when we
      // actually got a per-model value for that hour. Falling back
      // to the best-match (`hourly[param]`) made the backtest
      // compare the forecast against itself for any hour where the
      // per-model entry was missing, which produced RMSE=0 cells
      // and over-weighted models with sparse coverage (HRRR outside
      // CONUS, AIGFS over polar regions, …).
      for (const modelId of modelIds) {
        const modelKey = `${param}_${modelId}`
        const value = hourly[modelKey]?.[i]
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        rows.push({
          model_id: modelId,
          lat: location.lat,
          lon: location.lon,
          init_time: validTime,
          valid_time: validTime,
          lead_time_hours: 0,
          metric,
          predicted_value: value,
        })
      }

      // Previous day forecasts (lead time 1-7 days)
      for (let day = 1; day <= 7; day++) {
        const prevParam = `${param}_previous_day${day}`
        for (const modelId of modelIds) {
          const modelKey = `${prevParam}_${modelId}`
          const value = hourly[modelKey]?.[i] ?? null
          if (typeof value === 'number' && Number.isFinite(value)) {
            // Reference time for this fixed offset, NOT the actual model
            // initialization (which this API does not expose). UTC elapsed
            // hours avoid ambiguity at daylight-saving transitions.
            rows.push({
              model_id: modelId,
              lat: location.lat,
              lon: location.lon,
              init_time: shiftArchiveHours(validTime, -day * 24),
              valid_time: validTime,
              lead_time_hours: day * 24,
              metric,
              predicted_value: value,
            })
          }
        }
      }
    }
  }

  return rows
}

/**
 * Shift a wall-clock stamp ('YYYY-MM-DDTHH:mm' as returned by the
 * provider's `hourly.time`, timezone=auto) by whole calendar days.
 *
 * B-NBT-1 (2026-08-22): the previous implementation round-tripped the
 * string through `new Date(...)` + `toISOString()`, which interprets
 * the wall-clock in the HOST timezone and re-emits it as UTC. On a
 * CEST machine every `previous_dayN` init_time landed 2 h off the
 * observation grid, so the verifier paired forecasts with observations
 * from the wrong hour (and, for edge hours, dropped them entirely).
 * Calendar math on the date part keeps the wall-clock semantics: the
 * result stays on the same 'YYYY-MM-DDTHH:mm' grid the ERA5 rows use.
 *
 * Exported for unit tests.
 */
export function shiftWallClockDays(stamp: string, days: number): string {
  const datePart = stamp.slice(0, 10)
  const timePart = stamp.slice(10)
  const [y, m, d] = datePart.split('-').map(Number)
  // Date.UTC over pure Y/M/D numbers is a safe calendar shift: no host
  // timezone ever touches the wall-clock value.
  const shifted = new Date(Date.UTC(y, m - 1, d + days))
  return `${shifted.toISOString().slice(0, 10)}${timePart}`
}

/**
 * Determine lead time bucket from lead_time_hours.
 */
export function leadTimeBucket(hours: number): string {
  if (hours <= 24) return '0-24h'
  if (hours <= 48) return '24-48h'
  if (hours <= 72) return '48-72h'
  if (hours <= 96) return '72-96h'
  if (hours <= 120) return '96-120h'
  return '120-168h'
}

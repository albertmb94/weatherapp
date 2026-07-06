/**
 * Fetch historical forecast data from Open-Meteo's Previous Runs API.
 * This provides forecast values at fixed lead-time offsets (1-7 days).
 */

import { fetchWithTimeout } from '@/lib/fetchWithTimeout'
import type { ForecastArchiveRow } from './db'
import { BACKTEST_MODEL_IDS, BACKTEST_METRICS, type BacktestLocation } from './config'

const PREVIOUS_RUNS_BASE = 'https://previous-runs-api.open-meteo.com/v1/forecast'

const METRIC_TO_PARAM: Record<string, string> = {
  temperature: 'temperature_2m',
  wind_speed: 'wind_speed_10m',
  precipitation: 'precipitation',
}

/**
 * Fetch previous-day forecasts for a location and date range.
 * Returns an array of rows ready for DB insertion.
 */
export async function fetchPreviousRuns(
  location: BacktestLocation,
  startDate: string, // YYYY-MM-DD
  endDate: string,   // YYYY-MM-DD
  signal?: AbortSignal
): Promise<ForecastArchiveRow[]> {
  const rows: ForecastArchiveRow[] = []
  const models = BACKTEST_MODEL_IDS.join(',')
  const hourlyParams = BACKTEST_METRICS.map(m => METRIC_TO_PARAM[m]).join(',')

  // Build previous-day params: _previous_day1 through _previous_day7
  const previousParams = Array.from({ length: 7 }, (_, i) =>
    BACKTEST_METRICS.map(m => `${METRIC_TO_PARAM[m]}_previous_day${i + 1}`).join(',')
  ).join(',')

  const params = new URLSearchParams({
    latitude: location.lat.toString(),
    longitude: location.lon.toString(),
    hourly: `${hourlyParams},${previousParams}`,
    models,
    start_date: startDate,
    end_date: endDate,
    timezone: 'auto',
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

  const times: string[] = hourly.time

  for (let i = 0; i < times.length; i++) {
    const validTime = times[i]

    for (const metric of BACKTEST_METRICS) {
      const param = METRIC_TO_PARAM[metric]

      // Current forecast (lead time 0)
      const currentValue = hourly[param]?.[i] ?? null
      if (currentValue !== null) {
        for (const modelId of BACKTEST_MODEL_IDS) {
          const modelKey = `${param}_${modelId}`
          const value = hourly[modelKey]?.[i] ?? currentValue
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
      }

      // Previous day forecasts (lead time 1-7 days)
      for (let day = 1; day <= 7; day++) {
        const prevParam = `${param}_previous_day${day}`
        for (const modelId of BACKTEST_MODEL_IDS) {
          const modelKey = `${prevParam}_${modelId}`
          const value = hourly[modelKey]?.[i] ?? null
          if (value !== null) {
            // The "init_time" for a previous_dayN forecast is N days before valid_time
            const initDate = new Date(validTime)
            initDate.setDate(initDate.getDate() - day)
            rows.push({
              model_id: modelId,
              lat: location.lat,
              lon: location.lon,
              init_time: initDate.toISOString().slice(0, 16),
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

/**
 * Fetch ERA5 reanalysis data as ground truth for forecast verification.
 * Uses Open-Meteo's Historical Weather API.
 */

import { fetchWithTimeout } from '@/lib/fetchWithTimeout'
import type { ObservationRow } from './db'
import { BACKTEST_METRICS, type BacktestLocation } from './config'

const ERA5_BASE = 'https://archive-api.open-meteo.com/v1/archive'

const METRIC_TO_PARAM: Record<string, string> = {
  temperature: 'temperature_2m',
  wind_speed: 'wind_speed_10m',
  precipitation: 'precipitation',
}

/**
 * Fetch ERA5 observations for a location and date range.
 * Returns rows ready for DB insertion.
 */
export async function fetchERA5Observations(
  location: BacktestLocation,
  startDate: string, // YYYY-MM-DD
  endDate: string,   // YYYY-MM-DD
  signal?: AbortSignal
): Promise<ObservationRow[]> {
  const rows: ObservationRow[] = []
  const hourlyParams = BACKTEST_METRICS.map(m => METRIC_TO_PARAM[m]).join(',')

  const params = new URLSearchParams({
    latitude: location.lat.toString(),
    longitude: location.lon.toString(),
    hourly: hourlyParams,
    // Pin the reanalysis model so the backtest is reproducible
    // across Open-Meteo backend upgrades. Without this the API
    // returns an undocumented "best match" mixing ERA5, ERA5-Land,
    // ERA5-Ensemble and CERRA which makes window-over-window
    // accuracy comparisons unreliable.
    models: 'era5_seamless',
    start_date: startDate,
    end_date: endDate,
    timezone: 'auto',
  })

  const res = await fetchWithTimeout(`${ERA5_BASE}?${params}`, {
    signal,
    timeoutMs: 25_000,
  })

  if (!res.ok) {
    throw new Error(`ERA5 API error: ${res.status}`)
  }

  const data = await res.json()
  const hourly = data.hourly
  if (!hourly?.time) return rows

  const times: string[] = hourly.time

  for (let i = 0; i < times.length; i++) {
    const validTime = times[i]

    for (const metric of BACKTEST_METRICS) {
      const param = METRIC_TO_PARAM[metric]
      const value = hourly[param]?.[i] ?? null
      if (value !== null) {
        rows.push({
          lat: location.lat,
          lon: location.lon,
          valid_time: validTime,
          metric,
          observed_value: value,
        })
      }
    }
  }

  return rows
}

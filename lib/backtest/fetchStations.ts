/**
 * Real station observations (XEMA / Catalonia) for the truth archive.
 *
 * XEMA's historical endpoint returns a whole day of one variable for the
 * whole network. Readings are timestamps in UTC; the ERA5 and Previous
 * Runs archives we compare against use the location's LOCAL wall clock
 * (`timezone=auto`), so every reading is converted to Europe/Madrid
 * before it is stored — otherwise a 2 h offset silently corrupts the join.
 */

import { parseStationsMetadata, parseVariableReadings, XEMA_VAR, type StationMeta } from '../meteocat'
import type { StationObservationRow } from './db'

const XEMA_BASE = 'https://api.meteo.cat/xema/v1'

/** app metric id → XEMA measured-variable code. */
export const METRIC_TO_XEMA: Record<string, number> = {
  temperature: XEMA_VAR.TEMP,
  precipitation: XEMA_VAR.PRECIP,
  humidity: XEMA_VAR.HUMIDITY,
  wind_speed: XEMA_VAR.WIND_SPEED,
}

interface XemaReading {
  data: string
  valor: number
}

/**
 * Convert a UTC instant to the Europe/Madrid wall-clock stamp
 * `YYYY-MM-DDTHH:mm`, the same shape the ERA5/Previous Runs archives use.
 */
export function madridWallClock(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    const hour = get('hour') === '24' ? '00' : get('hour')
    return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
  } catch {
    return null
  }
}

/** Pure mapper: parsed XEMA readings → archive rows (testable offline). */
export function xemaReadingsToRows(
  meta: Map<string, StationMeta>,
  readings: Record<string, Map<string, XemaReading[]>>,
  source = 'xema',
): StationObservationRow[] {
  const rows: StationObservationRow[] = []
  for (const [metric, byStation] of Object.entries(readings)) {
    for (const [code, list] of byStation) {
      const station = meta.get(code)
      if (!station) continue
      for (const reading of list) {
        const validTime = madridWallClock(reading.data)
        if (!validTime || !Number.isFinite(reading.valor)) continue
        rows.push({
          source,
          station_id: code,
          station_name: station.name,
          lat: station.lat,
          lon: station.lon,
          valid_time: validTime,
          metric,
          // XEMA wind is m/s; the app's `wind_speed` is km/h.
          observed_value: metric === 'wind_speed' ? reading.valor * 3.6 : reading.valor,
        })
      }
    }
  }
  return rows
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  const start = new Date(`${from}T00:00:00Z`).getTime()
  const end = new Date(`${to}T00:00:00Z`).getTime()
  for (let t = start; t <= end && out.length < 120; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/**
 * Fetch XEMA hourly observations for [dateFrom, dateTo] (inclusive).
 * One metadata request plus one request per (day × metric). Callers must
 * respect XEMA's monthly quota — archive a bounded window.
 */
export async function fetchXemaObservations(
  dateFrom: string,
  dateTo: string,
  apiKey: string,
  metrics: readonly string[] = Object.keys(METRIC_TO_XEMA),
  signal?: AbortSignal,
  onProgress?: (msg: string) => void,
): Promise<StationObservationRow[]> {
  const get = async (url: string): Promise<unknown> => {
    const res = await fetch(url, {
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      signal: signal ?? AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`XEMA ${res.status} (${url})`)
    return res.json()
  }

  const meta = parseStationsMetadata(await get(`${XEMA_BASE}/estacions/metadades`))
  const rows: StationObservationRow[] = []

  for (const day of dateRange(dateFrom, dateTo)) {
    const [y, m, d] = day.split('-')
    const readings: Record<string, Map<string, XemaReading[]>> = {}
    for (const metric of metrics) {
      const code = METRIC_TO_XEMA[metric]
      if (code === undefined) continue
      try {
        readings[metric] = parseVariableReadings(
          await get(`${XEMA_BASE}/variables/mesurades/${code}/${y}/${m}/${d}`),
        ) as Map<string, XemaReading[]>
      } catch (err) {
        onProgress?.(`  ${day} ${metric}: ${(err as Error).message}`)
        readings[metric] = new Map()
      }
    }
    const dayRows = xemaReadingsToRows(meta, readings)
    rows.push(...dayRows)
    onProgress?.(`  ${day}: ${dayRows.length} lecturas`)
  }

  return rows
}

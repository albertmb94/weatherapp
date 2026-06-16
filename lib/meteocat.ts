import type { MeteoclimaticObservation } from './meteoclimatic-types'

// Meteocat XEMA (official automatic weather station network of Catalonia)
// REST API. Docs: https://apidocs.meteocat.gencat.cat/
//
// Auth is an `X-Api-Key` header tied to a (free for personal use) consumption
// plan. Quotas are monthly, so callers MUST cache aggressively — XEMA only
// updates every ~30 min, and this module is designed to fetch the whole
// network once (independent of the user's location) so a single cached
// response serves every client.
const BASE_URL = 'https://api.meteo.cat/xema/v1'

// XEMA measured-variable codes. Centralised so they are easy to audit/fix
// against /variables/mesurades/metadades.
export const XEMA_VAR = {
  TEMP: 32, // Temperatura (°C)
  HUMIDITY: 33, // Humitat relativa (%)
  PRESSURE: 34, // Pressió atmosfèrica (hPa)
  WIND_SPEED: 30, // Velocitat del vent a 10 m (m/s)
  WIND_DIR: 31, // Direcció del vent a 10 m (°)
  PRECIP: 35, // Precipitació (mm, acumulada per base horària)
} as const

const DIRECTIONS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
function bearingToDirection(bearing: number): string {
  return DIRECTIONS[Math.round(bearing / 22.5) % 16]
}

export interface StationMeta {
  name: string
  lat: number
  lon: number
}

interface Reading {
  data: string
  valor: number
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Parse the /estacions/metadades response into a map keyed by station code.
 * The response is an array of stations; coordinates live under `coordenades`.
 */
export function parseStationsMetadata(json: unknown): Map<string, StationMeta> {
  const out = new Map<string, StationMeta>()
  if (!Array.isArray(json)) return out
  for (const s of json) {
    if (!s || typeof s !== 'object') continue
    const rec = s as Record<string, unknown>
    const code = typeof rec.codi === 'string' ? rec.codi : null
    const coords = rec.coordenades as Record<string, unknown> | undefined
    const lat = num(coords?.latitud)
    const lon = num(coords?.longitud)
    if (!code || lat === null || lon === null) continue
    out.set(code, {
      name: typeof rec.nom === 'string' ? rec.nom : code,
      lat,
      lon,
    })
  }
  return out
}

/**
 * Parse a /variables/mesurades/{codi}/{y}/{m}/{d} response (one variable, all
 * stations, one day) into a map: station code -> chronologically sorted
 * readings. Each station entry exposes its variable's `lectures`.
 */
export function parseVariableReadings(json: unknown): Map<string, Reading[]> {
  const out = new Map<string, Reading[]>()
  if (!Array.isArray(json)) return out
  for (const s of json) {
    if (!s || typeof s !== 'object') continue
    const rec = s as Record<string, unknown>
    const code = typeof rec.codi === 'string' ? rec.codi : null
    if (!code) continue
    const variables = rec.variables as unknown[] | undefined
    const first = Array.isArray(variables) ? (variables[0] as Record<string, unknown> | undefined) : undefined
    const lectures = first?.lectures as unknown[] | undefined
    if (!Array.isArray(lectures)) continue
    const readings: Reading[] = []
    for (const l of lectures) {
      if (!l || typeof l !== 'object') continue
      const lr = l as Record<string, unknown>
      const valor = num(lr.valor)
      const data = typeof lr.data === 'string' ? lr.data : ''
      if (valor === null) continue
      readings.push({ data, valor })
    }
    readings.sort((a, b) => a.data.localeCompare(b.data))
    out.set(code, readings)
  }
  return out
}

function last(readings: Reading[] | undefined): Reading | null {
  return readings && readings.length > 0 ? readings[readings.length - 1] : null
}
function maxOf(readings: Reading[] | undefined): number | null {
  if (!readings || readings.length === 0) return null
  return readings.reduce((m, r) => (r.valor > m ? r.valor : m), readings[0].valor)
}
function minOf(readings: Reading[] | undefined): number | null {
  if (!readings || readings.length === 0) return null
  return readings.reduce((m, r) => (r.valor < m ? r.valor : m), readings[0].valor)
}
function sumOf(readings: Reading[] | undefined): number | null {
  if (!readings || readings.length === 0) return null
  return readings.reduce((s, r) => s + r.valor, 0)
}

/**
 * Combine station metadata with per-variable readings into the shared
 * MeteoclimaticObservation shape consumed by the UI. Stations with no
 * temperature reading are dropped (nothing meaningful to show on the map).
 */
export function buildMeteocatObservations(
  meta: Map<string, StationMeta>,
  byVar: Record<keyof typeof XEMA_VAR, Map<string, Reading[]>>
): MeteoclimaticObservation[] {
  const out: MeteoclimaticObservation[] = []
  for (const [code, m] of meta) {
    const temp = byVar.TEMP.get(code)
    const tempLast = last(temp)
    if (tempLast === null) continue // no current temperature -> skip

    const windLast = last(byVar.WIND_SPEED.get(code))
    const dirLast = last(byVar.WIND_DIR.get(code))
    const bearing = dirLast?.valor ?? null

    out.push({
      code,
      name: m.name,
      lat: m.lat,
      lon: m.lon,
      updatedAt: tempLast.data,
      temperature: {
        current: tempLast.valor,
        max: maxOf(temp),
        min: minOf(temp),
      },
      condition: '',
      humidity: { current: last(byVar.HUMIDITY.get(code))?.valor ?? null, max: null, min: null },
      pressure: { current: last(byVar.PRESSURE.get(code))?.valor ?? null, max: null, min: null },
      wind: {
        // XEMA reports wind in m/s; convert to km/h to match AEMET/Meteoclimatic.
        speed: windLast ? windLast.valor * 3.6 : null,
        gust: null,
        bearing,
        direction: bearing !== null ? bearingToDirection(bearing) : '',
      },
      precipitation: sumOf(byVar.PRECIP.get(code)),
    })
  }
  return out
}

/** yyyy/mm/dd path components for "today" in Catalonia's timezone. */
function todayPathMadrid(now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
    return `${get('year')}/${get('month')}/${get('day')}`
  } catch {
    // Fallback to UTC if the runtime lacks tz data.
    return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}`
  }
}

async function getJson(url: string, apiKey: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    signal: signal ?? AbortSignal.timeout(15000),
    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Meteocat ${res.status}`)
  return res.json()
}

/**
 * Fetch the whole XEMA network's current conditions. Deliberately independent
 * of the user's location so the result can be cached once and shared, keeping
 * us well under the monthly quota. Callers filter by radius afterwards.
 */
export async function fetchMeteocatStations(apiKey: string, signal?: AbortSignal): Promise<MeteoclimaticObservation[]> {
  const day = todayPathMadrid()
  // The XEMA API rejects `?estat=ope` unless `data=` is also supplied
  // (HTTP 400: "Els paràmetres 'data' i 'estat' són necessaris conjuntament").
  // Returning all stations is cheap (~245 records, single response) and the
  // downstream pipeline drops anything without a current temperature reading,
  // so non-operational stations fall out naturally without extra filtering.
  const metaJson = await getJson(`${BASE_URL}/estacions/metadades`, apiKey, signal)
  const meta = parseStationsMetadata(metaJson)

  const entries = Object.entries(XEMA_VAR) as [keyof typeof XEMA_VAR, number][]
  const results = await Promise.all(
    entries.map(([, code]) =>
      getJson(`${BASE_URL}/variables/mesurades/${code}/${day}`, apiKey, signal)
        .then(parseVariableReadings)
        // A single variable failing (e.g. quota on one resource) shouldn't
        // sink the whole response — degrade by treating it as empty.
        .catch(() => new Map<string, Reading[]>())
    )
  )

  const byVar = {} as Record<keyof typeof XEMA_VAR, Map<string, Reading[]>>
  entries.forEach(([key], i) => {
    byVar[key] = results[i]
  })

  return buildMeteocatObservations(meta, byVar)
}

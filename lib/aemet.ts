export interface AemetRaw {
  idema: string
  ubi: string
  lat: number
  lon: number
  fint: string
  ta: number | null
  tamax: number | null
  tamin: number | null
  hr: number | null
  vv: number | null
  vmax: number | null
  dv: number | null
  prec: number | null
  alt: number | null
}

const AEMET_BASE = 'https://opendata.aemet.es/opendata/api'

function getApiKey(): string {
  const key = process.env.AEMET_API_KEY
  if (!key) throw new Error('AEMET_API_KEY not configured')
  return key
}

async function aemetFetch<T>(path: string): Promise<T> {
  const key = getApiKey()
  const res = await fetch(`${AEMET_BASE}${path}?api_key=${key}`, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`AEMET metadata failed: ${res.status}`)
  const meta = await res.json()
  if (!meta.datos) throw new Error('AEMET: no datos URL')
  const dataRes = await fetch(meta.datos, { signal: AbortSignal.timeout(30000) })
  if (!dataRes.ok) throw new Error(`AEMET data failed: ${dataRes.status}`)
  return dataRes.json()
}

// Server-side memo to avoid re-fetching from the upstream AEMET API on every
// request. AEMET data refreshes ~every 10 min, so a 4-minute TTL keeps the
// data reasonably fresh while eliminating redundant upstream calls.
let memo: { at: number; stations: AemetRaw[] } | null = null
const MEMO_TTL_MS = 4 * 60 * 1000

export async function fetchAemetStations(): Promise<AemetRaw[]> {
  if (memo && Date.now() - memo.at < MEMO_TTL_MS) return memo.stations
  const stations = await aemetFetch<AemetRaw[]>('/observacion/convencional/todas')
  memo = { at: Date.now(), stations }
  return stations
}

export function getStaleAemetStations(): AemetRaw[] | null {
  return memo?.stations ?? null
}

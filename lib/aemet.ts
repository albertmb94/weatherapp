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

export async function fetchAemetStations(): Promise<AemetRaw[]> {
  return aemetFetch<AemetRaw[]>('/observacion/convencional/todas')
}

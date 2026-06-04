export interface AemetObservation {
  idema: string
  nombre: string
  lat: number
  lon: number
  fint: string
  tmed: number | null
  tmax: number | null
  tmin: number | null
  hum: number | null
  hum_max: number | null
  hum_min: number | null
  pres: number | null
  pres_max: number | null
  pres_min: number | null
  velmedia: number | null
  racha: number | null
  dir: number | null
  prec: number | null
}

export interface AemetFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: AemetObservation
}

export interface AemetResponse {
  features: AemetFeature[]
}

const AEMET_BASE = 'https://opendata.aemet.es/opendata/api'

function getApiKey(): string {
  const key = process.env.AEMET_API_KEY
  if (!key) throw new Error('AEMET_API_KEY not configured')
  return key
}

function aemetUrl(path: string): string {
  return `${AEMET_BASE}${path}?api_key=${getApiKey()}`
}

async function fetchAemetJson<T>(path: string): Promise<T> {
  const url = aemetUrl(path)
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`AEMET fetch failed: ${res.status}`)
  const json = await res.json()
  if (json.datos) {
    const dataRes = await fetch(json.datos, { signal: AbortSignal.timeout(15000) })
    if (!dataRes.ok) throw new Error(`AEMET data fetch failed: ${dataRes.status}`)
    return dataRes.json()
  }
  return json
}

export async function fetchAemetStations(): Promise<AemetObservation[]> {
  const data = await fetchAemetJson<AemetResponse>('/api/observacion/convencional/todas')
  return (data.features ?? []).map(f => f.properties)
}

export async function fetchAemetStation(idema: string): Promise<AemetObservation[]> {
  const data = await fetchAemetJson<AemetResponse>(`/api/observacion/convencional/datos/estacion/${idema}`)
  return (data.features ?? []).map(f => f.properties)
}

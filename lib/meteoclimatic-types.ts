export interface MeteoclimaticObservation {
  code: string
  name: string
  lat: number
  lon: number
  updatedAt: string
  temperature: {
    current: number | null
    max: number | null
    min: number | null
  }
  condition: string
  humidity: {
    current: number | null
    max: number | null
    min: number | null
  }
  pressure: {
    current: number | null
    max: number | null
    min: number | null
  }
  wind: {
    speed: number | null
    gust: number | null
    bearing: number | null
    direction: string
  }
  precipitation: number | null
}

export interface MeteoclimaticResponse {
  stations: MeteoclimaticObservation[]
  fetchedAt: string
}

export interface RegionOption {
  code: string
  label: string
  latMin: number
  latMax: number
  lonMin: number
  lonMax: number
}

export const REGIONS: RegionOption[] = [
  { code: 'BCN', label: 'Barcelona', latMin: 41.2, latMax: 42.1, lonMin: 1.4, lonMax: 2.3 },
  { code: 'LLE', label: 'Lleida', latMin: 41.2, latMax: 42.9, lonMin: 0.5, lonMax: 1.8 },
  { code: 'GIR', label: 'Girona', latMin: 41.7, latMax: 42.5, lonMin: 2.3, lonMax: 3.3 },
  { code: 'TAR', label: 'Tarragona', latMin: 40.7, latMax: 41.7, lonMin: 0.2, lonMax: 1.8 },
  { code: 'CAT', label: 'Catalunya', latMin: 40.7, latMax: 42.9, lonMin: 0.2, lonMax: 3.3 },
  { code: 'MAD', label: 'Madrid', latMin: 39.9, latMax: 41.1, lonMin: -4.4, lonMax: -3.0 },
  { code: 'VLC', label: 'València', latMin: 38.0, latMax: 40.1, lonMin: -1.2, lonMax: 1.0 },
  { code: 'BCN_C', label: 'Barcelona Capital', latMin: 41.32, latMax: 41.47, lonMin: 2.07, lonMax: 2.23 },
]

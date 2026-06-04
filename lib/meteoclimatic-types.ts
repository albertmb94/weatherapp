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
}

export const REGIONS: RegionOption[] = [
  { code: 'ESCAT08', label: 'Barcelona' },
  { code: 'ESCAT25', label: 'Lleida' },
  { code: 'ESCAT17', label: 'Girona' },
  { code: 'ESCAT43', label: 'Tarragona' },
  { code: 'ESCAT', label: 'Catalunya' },
  { code: 'ESPVA', label: 'Comunitat Valenciana' },
  { code: 'ESMUR', label: 'Murcia' },
  { code: 'ESMAD', label: 'Madrid' },
  { code: 'ESAND', label: 'Andalucía' },
  { code: 'ESGAL', label: 'Galicia' },
  { code: 'ESEUS', label: 'Euskadi' },
  { code: 'ESCTB', label: 'Cantabria' },
  { code: 'ESAST', label: 'Asturias' },
  { code: 'ESARA', label: 'Aragón' },
  { code: 'ESCLM', label: 'Castilla-La Mancha' },
  { code: 'ESCYL', label: 'Castilla y León' },
  { code: 'ESEXT', label: 'Extremadura' },
  { code: 'ESIB', label: 'Illes Balears' },
  { code: 'ESIC', label: 'Canarias' },
]

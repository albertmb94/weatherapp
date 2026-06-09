const LOCAL_KEY = 'weather-saved-locations'

export interface SavedLocation {
  id: number
  name: string
  latitude: number
  longitude: number
}

function getNextId(locations: SavedLocation[]): number {
  return locations.length > 0 ? Math.max(...locations.map(l => l.id)) + 1 : 1
}

export function getLocalSavedLocations(): SavedLocation[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    return raw ? (JSON.parse(raw) as SavedLocation[]) : []
  } catch {
    return []
  }
}

export function saveLocalLocation(name: string, latitude: number, longitude: number): SavedLocation {
  const locations = getLocalSavedLocations()
  const id = getNextId(locations)
  const loc: SavedLocation = { id, name, latitude, longitude }
  locations.push(loc)
  localStorage.setItem(LOCAL_KEY, JSON.stringify(locations))
  return loc
}

export function deleteLocalLocation(id: number): void {
  const locations = getLocalSavedLocations().filter(l => l.id !== id)
  localStorage.setItem(LOCAL_KEY, JSON.stringify(locations))
}

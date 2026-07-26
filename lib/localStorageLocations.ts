const LOCAL_KEY = 'weather-saved-locations'

export interface SavedLocation {
  id: number
  name: string
  latitude: number
  longitude: number
}

/**
 * Generate a positive 32-bit identifier backed by `crypto.randomUUID()`.
 *
 * Previously we used `Math.max(...ids) + 1` which is brittle when two tabs
 * write concurrently or when the localStorage payload has been tampered
 * with to contain MAX_SAFE_INTEGER / NaN.
 */
function nextId(): number {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  // Stable hashing into the 31-bit signed range expected by JSON consumers.
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0
  }
  return Math.abs(hash) || 1
}

export function getLocalSavedLocations(): SavedLocation[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? (parsed.filter(isValidLocation) as SavedLocation[])
      : []
  } catch {
    return []
  }
}

export function saveLocalLocation(name: string, latitude: number, longitude: number): SavedLocation {
  const locations = getLocalSavedLocations()
  const loc: SavedLocation = { id: nextId(), name, latitude, longitude }
  locations.push(loc)
  localStorage.setItem(LOCAL_KEY, JSON.stringify(locations))
  return loc
}

export function deleteLocalLocation(id: number): void {
  const locations = getLocalSavedLocations().filter(l => l.id !== id)
  localStorage.setItem(LOCAL_KEY, JSON.stringify(locations))
}

function isValidLocation(value: unknown): value is SavedLocation {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'number' &&
    typeof v.name === 'string' &&
    typeof v.latitude === 'number' &&
    typeof v.longitude === 'number'
  )
}

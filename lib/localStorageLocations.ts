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

// B-NEW-29 (2026-07-30): two locations are considered the "same
// place" when the display name matches AND the coordinates are
// within ~50 m. The tolerance (0.0005 degrees) matches the one
// `home-content.tsx` uses to identify the currently-loaded city
// inside the saved list, so a re-save round-trips cleanly. Names
// are compared case-insensitively because geocoders occasionally
// return the same city with a different capitalisation
// ("Barcelona" vs "barcelona").
const DEDUP_COORD_TOLERANCE = 0.0005
function isSameLocation(
  candidate: SavedLocation,
  name: string,
  latitude: number,
  longitude: number,
): boolean {
  return (
    candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase() &&
    Math.abs(candidate.latitude - latitude) < DEDUP_COORD_TOLERANCE &&
    Math.abs(candidate.longitude - longitude) < DEDUP_COORD_TOLERANCE
  )
}

export function saveLocalLocation(name: string, latitude: number, longitude: number): SavedLocation {
  const locations = getLocalSavedLocations()
  // Dedup: if a location with the same name and ~50m-tolerated
  // coords already exists, return the existing record instead of
  // pushing a duplicate. The UI also disables the Save button in
  // that case (see `currentCityId` in home-content.tsx + the
  // mobile-menu Save button), but we treat the data layer as the
  // single source of truth: any code path that calls
  // `saveLocalLocation` for an already-saved place must be
  // idempotent. The user reported the same city appearing two or
  // three times in the saved list when they tapped Save more than
  // once on the same view; this is the fix.
  const existing = locations.find(l => isSameLocation(l, name, latitude, longitude))
  if (existing) return existing
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

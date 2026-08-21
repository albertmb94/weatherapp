const STORAGE_KEY = 'weather-last-view'

// B-NEW-41 (2026-08-18): `showMap` and `showRadar` removed from the
// snapshot — the Mapa view, heatmap and radar are permanently disabled
// in this build, so persisting them was dead weight.
export interface LastViewSnapshot {
  metric: string
  models: string[]
  range: number
  bucket: number
  marine: boolean
  basic: boolean
}

export function loadLastView(): LastViewSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as LastViewSnapshot) : null
  } catch {
    return null
  }
}

export function saveLastView(snapshot: LastViewSnapshot): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Storage quota exceeded — silently ignore. The URL still carries
    // the current view for sharing.
  }
}

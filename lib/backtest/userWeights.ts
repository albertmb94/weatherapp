/**
 * User-specific weight persistence.
 * Stores and retrieves dynamic weights for specific user locations.
 */

import { getDb } from '@/lib/db'

const STORAGE_KEY = 'weather-dynamic-weights'
const MAX_ENTRIES = 50 // Max locations to track weights for
const ENTRY_TTL_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

export interface UserWeightEntry {
  lat: number
  lon: number
  weights: Record<string, number>
  metric: string
  leadTimeBucket: string
  lastUsed: number
}

/**
 * Get user-specific weights for a location from localStorage.
 * Returns null if no weights are stored for this location.
 */
export function getUserWeights(
  lat: number,
  lon: number,
  metric: string = 'temperature',
  leadTimeBucket: string = '0-24h'
): Record<string, number> | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const entries: UserWeightEntry[] = JSON.parse(raw)
    const key = `${lat.toFixed(2)}:${lon.toFixed(2)}`
    const entry = entries.find(e =>
      `${e.lat.toFixed(2)}:${e.lon.toFixed(2)}` === key &&
      e.metric === metric &&
      e.leadTimeBucket === leadTimeBucket
    )

    if (!entry) return null
    if (Date.now() - entry.lastUsed > ENTRY_TTL_MS) return null

    return entry.weights
  } catch {
    return null
  }
}

/**
 * Save user-specific weights for a location to localStorage.
 */
export function saveUserWeights(
  lat: number,
  lon: number,
  weights: Record<string, number>,
  metric: string = 'temperature',
  leadTimeBucket: string = '0-24h'
): void {
  if (typeof window === 'undefined') return

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const entries: UserWeightEntry[] = raw ? JSON.parse(raw) : []

    const key = `${lat.toFixed(2)}:${lon.toFixed(2)}`
    const existingIdx = entries.findIndex(e =>
      `${e.lat.toFixed(2)}:${e.lon.toFixed(2)}` === key &&
      e.metric === metric &&
      e.leadTimeBucket === leadTimeBucket
    )

    const entry: UserWeightEntry = {
      lat,
      lon,
      weights,
      metric,
      leadTimeBucket,
      lastUsed: Date.now(),
    }

    if (existingIdx >= 0) {
      entries[existingIdx] = entry
    } else {
      entries.push(entry)
    }

    // Prune old entries
    const now = Date.now()
    const pruned = entries
      .filter(e => now - e.lastUsed < ENTRY_TTL_MS)
      .slice(-MAX_ENTRIES)

    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned))
  } catch {
    // Storage quota exceeded — silently ignore
  }
}

/**
 * Clear all stored user weights.
 */
export function clearUserWeights(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

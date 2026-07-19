'use client'

// F-5 + auto-refresh: store snapshots per location (rounded coords), so we
// can answer "is the data for *this* location older than 4h?" without
// surfacing the snapshot of a different city under the wrong name.

import type { ForecastResult } from './openMeteo'

const DB_NAME = 'weather-offline'
const STORE_NAME = 'forecasts'
const VERSION = 2

export interface ForecastSnapshot {
  position: [number, number]
  cityName: string
  utcOffsetSeconds: number
  fetchedAt: number
  data: ForecastResult
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'))
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
        // Migration from v1: the old "latest" key stored a single snapshot
        // regardless of location, which made the app show stale data for
        // the current city when the cached snapshot was from a previous one.
        if (db.objectStoreNames.contains('lastForecast')) {
          db.deleteObjectStore('lastForecast')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

/** Round coords to ~1 km so a re-pick of the same place hits the cache,
 *  while still rejecting snapshots from a noticeably different position. */
function locationKey(position: [number, number]): string {
  return `${position[0].toFixed(2)}:${position[1].toFixed(2)}`
}

export async function saveLastForecast(snapshot: ForecastSnapshot): Promise<void> {
  try {
    const db = await openDb()
    const key = locationKey(snapshot.position)
    return await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(snapshot, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // Offline persistence is best-effort; don't break the UI.
  }
}

/** Load a snapshot for the *exact* location (within ~1 km tolerance).
 *  Returns null when there's no cached snapshot for this place — callers
 *  used to get a snapshot from a different city and present it under the
 *  current city's name. */
export async function loadLastForecast(position?: [number, number]): Promise<ForecastSnapshot | null> {
  if (typeof position === 'undefined') return null
  try {
    const db = await openDb()
    const targetKey = locationKey(position)
    return await new Promise<ForecastSnapshot | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(targetKey)
      req.onsuccess = () => resolve((req.result as ForecastSnapshot) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/** All snapshots — used by the auto-refresh ticker to decide which
 *  locations need to be re-fetched in the background. */
export async function listSnapshots(): Promise<ForecastSnapshot[]> {
  try {
    const db = await openDb()
    return await new Promise<ForecastSnapshot[]>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).getAll()
      req.onsuccess = () => resolve((req.result as ForecastSnapshot[]) ?? [])
      req.onerror = () => resolve([])
    })
  } catch {
    return []
  }
}

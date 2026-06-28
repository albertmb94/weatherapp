'use client'

// F-5: tiny IndexedDB wrapper to persist the last successful forecast
// payload. We use idb-free hand-rolled code so we don't pull a 5kB
// dependency for two put/get calls.

const DB_NAME = 'weather-offline'
const STORE_NAME = 'lastForecast'
const VERSION = 1
const KEY = 'latest'

interface ForecastSnapshot {
  position: [number, number]
  cityName: string
  utcOffsetSeconds: number
  fetchedAt: number
  data: unknown
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
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

export async function saveLastForecast(snapshot: ForecastSnapshot): Promise<void> {
  try {
    const db = await openDb()
    return await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(snapshot, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // Offline persistence is best-effort; don't break the UI.
  }
}

export async function loadLastForecast(): Promise<ForecastSnapshot | null> {
  try {
    const db = await openDb()
    return await new Promise<ForecastSnapshot | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(KEY)
      req.onsuccess = () => resolve((req.result as ForecastSnapshot) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export type { ForecastSnapshot }
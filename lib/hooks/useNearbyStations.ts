/**
 * useNearbyStations — fetch the closest weather stations for a
 * user coordinate and return them as a flat list of
 * `StationObservation` ready for the nowcast.
 *
 * Previously the home view never passed any stations down to
 * `FriendlyHome` (the `stations` prop defaulted to `[]`), so the
 * nowcast hook was always running with an empty list. That
 * silently disabled the "station + ensemble" temperature blend
 * in the current weather card.
 *
 * Strategy: query both AEMET and Meteocat by coordinates with a
 * tight 10-km radius, deduplicate by coordinate cell, convert the
 * common `MeteoclimaticObservation` shape to `StationObservation`,
 * and let the nowcast pick the closest one.
 *
 * Meteoclimatic is intentionally not included here — it lags
 * AEMET/Meteocat by 15-30 min and would only ever be a
 * "last resort" when both official networks are offline.
 */
'use client'

import { useQuery } from '@tanstack/react-query'
import {
  meteoclimaticToStationObservation,
  type StationObservation,
} from '@/lib/nowcast'
import type { MeteoclimaticObservation } from '@/lib/meteoclimatic-types'

interface UseNearbyStationsArgs {
  lat: number
  lon: number
  /** km search radius. B-NBT-9b (2026-08-22): default is now 10 km,
   *  matching StationDashboard's mobile/desktop default — the old 5 km
   *  default silently excluded the nearest station for cities like
   *  Badalona, so the nowcast blend never fired while the Estaciones
   *  tab showed stations fine. Single source of truth: StationDashboard
   *  imports THIS constant. */
  radius?: number
  /** Disable fetching (e.g. when lat/lon are outside reasonable bounds). */
  enabled?: boolean
}

export const NEARBY_STATIONS_DEFAULT_RADIUS_KM = 10

const STATION_RETRY_COUNT = 2
const STATION_RETRY_DELAY_MS = 1000

async function fetchAemetStations(
  lat: number,
  lon: number,
  radius: number,
  signal: AbortSignal,
): Promise<MeteoclimaticObservation[]> {
  const res = await fetch(
    `/api/aemet?lat=${lat}&lon=${lon}&radius=${radius}`,
    { signal },
  )
  if (!res.ok) return []
  const body = await res.json()
  if (body.error || !Array.isArray(body.stations)) return []
  return body.stations as MeteoclimaticObservation[]
}

async function fetchMeteocatStations(
  lat: number,
  lon: number,
  radius: number,
  signal: AbortSignal,
): Promise<MeteoclimaticObservation[]> {
  const res = await fetch(
    `/api/meteocat?lat=${lat}&lon=${lon}&radius=${radius}`,
    { signal },
  )
  if (!res.ok) return []
  const body = await res.json()
  if (body.error || !Array.isArray(body.stations)) return []
  return body.stations as MeteoclimaticObservation[]
}

/**
 * Coarse 1-km coordinate key so a single station feeding the
 * AEMET and Meteocat networks doesn't appear twice.
 */
function cellKey(lat: number, lon: number): string {
  return `${Math.round(lat * 100)}:${Math.round(lon * 100)}`
}

export function useNearbyStations({
  lat,
  lon,
  radius = NEARBY_STATIONS_DEFAULT_RADIUS_KM,
  enabled = true,
}: UseNearbyStationsArgs): StationObservation[] {
  // Round to ~1 km so the query key is stable when the user
  // drags the map by a few metres. The station response itself
  // is location-sensitive (it filters by radius server-side), so
  // we don't want to refetch on tiny pan/zoom movements.
  const posKey = `${Math.round(lat * 100) / 100},${Math.round(lon * 100) / 100}`

  return useQuery<StationObservation[]>({
    queryKey: ['nearby-stations', posKey, radius],
    queryFn: async ({ signal }) => {
      const [aemet, meteocat] = await Promise.all([
        fetchAemetStations(lat, lon, radius, signal),
        fetchMeteocatStations(lat, lon, radius, signal),
      ])
      const byCell = new Map<string, StationObservation>()
      // AEMET wins ties — it has the freshest timestamps.
      for (const m of aemet) {
        const obs = meteoclimaticToStationObservation(m, 'aemet')
        if (!obs) continue
        const key = cellKey(obs.lat, obs.lon)
        if (!byCell.has(key)) byCell.set(key, obs)
      }
      for (const m of meteocat) {
        const obs = meteoclimaticToStationObservation(m, 'meteocat')
        if (!obs) continue
        const key = cellKey(obs.lat, obs.lon)
        if (!byCell.has(key)) byCell.set(key, obs)
      }
      return [...byCell.values()]
    },
    enabled,
    // 5 min: stations are usually refreshed by their providers on
    // a 10-min cadence, so a 5-min staleTime re-fetches just late
    // enough to pick up the next measurement.
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    // 4xx is a config / quota issue that won't recover; only
    // retry transient errors.
    retry: (failureCount, err) => {
      const msg = err instanceof Error ? err.message : ''
      if (/\b(400|401|403|404)\b/.test(msg)) return false
      return failureCount < STATION_RETRY_COUNT
    },
    retryDelay: STATION_RETRY_DELAY_MS,
  }).data ?? []
}

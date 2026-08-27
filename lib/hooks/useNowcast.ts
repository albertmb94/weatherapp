/**
 * S10 — Nowcast (closest-station short-term correction).
 *
 * Picks the freshest observation from any of the station sources
 * within 60 km and blends it with the ensemble reading at hour H+0.
 * The combined temperature is exposed as `nowcastTemperatureC` and is
 * surfaced in the friendly cards so the user sees a "closest station
 * + ensemble" temperature instead of the ensemble alone.
 *
 * Stations are queried on demand by `home-content.tsx`; this hook
 * only orchestrates the blending.
 */

import { useMemo } from 'react'
import {
  blendNowcast,
  pickClosestStation,
  type NowcastResult,
  type StationObservation,
} from '@/lib/nowcast'

interface UseNowcastOptions {
  userLat: number
  userLon: number
  nowIndex: number
  hourlyTemperatureC: (number | null)[]
  hourlyPrecipitationMm: (number | null)[]
  /** AEMET / Meteocat / Meteoclimatic observation lists. The hook
   *  selects the closest station with valid timestamp. */
  stations: StationObservation[]
  /** Optional wall-clock override. Component callers always leave
   *  this empty so we use `Date.now()`. */
  nowMs?: number
}



export function useNowcast({
  userLat,
  userLon,
  nowIndex,
  hourlyTemperatureC,
  hourlyPrecipitationMm,
  stations,
  nowMs,
}: UseNowcastOptions): NowcastResult {
  return useMemo(() => {
    // AUDITORIA: se etiqueta TODO como 'aemet', pero `useNearbyStations`
    // distingue con cuidado entre AEMET y Meteocat y mezcla ambas en la
    // misma lista. Aqui esa distincion se pierde, asi que una
    // observacion de Meteocat se atribuye a AEMET en la mezcla del
    // nowcast. Como `pickClosestStation` sólo usa `source` para
    // desempatar y trazar, no altera el valor mostrado — pero la
    // procedencia que se registra es incorrecta y confundira al proximo
    // que depure una discrepancia de temperatura.
    const closest = pickClosestStation(
      [{ source: 'aemet', stations }],
      userLat,
      userLon,
      nowMs,
    )
    return blendNowcast({
      userLat,
      userLon,
      hourlyTemperatureC,
      hourlyPrecipitationMm,
      nowIndex,
      station: closest,
      ...(nowMs !== undefined ? { nowMs } : {}),
    })
  }, [userLat, userLon, hourlyTemperatureC, hourlyPrecipitationMm, nowIndex, stations, nowMs])
}

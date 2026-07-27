import { haversineKm } from './geoDistance'
import type { MeteoclimaticObservation } from './meteoclimatic-types'

export interface StationObservation {
  /** Provider-specific id ("08001" for AEMET, "XEMA-X" for Meteocat). */
  id: string
  source: 'aemet' | 'meteocat' | 'meteoclimatic'
  lat: number
  lon: number
  /** km from the user's coordinate. */
  distanceKm: number
  /** Provider-reported timestamp for the observation (ms since epoch). */
  observedAt: number
  temperatureC: number | null
  humidityPct: number | null
  pressureHpa: number | null
  windKmh: number | null
  windDirDeg: number | null
  /** Instantaneous precipitation in mm (last 10-min accumulator from AEMET,
   *  current intensity from Meteoclimatic). `null` when the station
   *  doesn't report it (most Meteocat XEMA stations). Used by
   *  `blendNowcast` to ground the "rain?" cell in a real measurement
   *  instead of the ensemble model alone. */
  precipitationMm: number | null
}

export interface NowcastInput {
  /** User's current coordinate. */
  userLat: number
  userLon: number
  /** Forecast values for the *current* and the next *N* hours. */
  hourlyTemperatureC: (number | null)[]
  hourlyPrecipitationMm: (number | null)[]
  /** Hour index used to anchor the forecast (typically the startIndex). */
  nowIndex: number
  /** Closest station, if any. null when no station is reachable. */
  station: StationObservation | null
  /** Maximum age (ms) for a station observation to be considered "now". */
  freshnessMs?: number
  /** Weight given to the observation vs the ensemble; default 0.6. */
  observationWeight?: number
  /** Override for the current time — only used by tests so
   *  station.observedAt - now is deterministic. */
  nowMs?: number
}

export interface NowcastResult {
  temperatureC: number | null
  precipitationMm: number | null
  /** Δ between the observation and the ensemble average at the current
   *  hour. Surfaced so the UI can show "station is +0.4° colder than
   *  the ensemble" without recomputing. Null when no station. */
  observationDeltaC: number | null
  /** "fresh" → observation is < freshnessMs old. "stale" otherwise. */
  freshness: 'fresh' | 'stale' | 'unavailable'
  station: StationObservation | null
}

/**
 * Combine the closest live station reading with the first hours of the
 * ensemble to produce a more accurate "now" reading.
 *
 * Weighting rules:
 *  - observation_weight * temperature_obs + (1 - observation_weight) * ensemble_h0
 *    when both signals are valid.
 *  - falls back to the ensemble value alone when no observation is
 *    available OR the observation is older than `freshnessMs` (default
 *    90 min — AEMET publishes every 10 min so anything older suggests
 *    the station is offline).
 *  - falls back to the observation alone when the ensemble is null
 *    for that hour (rare, only happens during a degraded upstream).
 */
export function blendNowcast(input: NowcastInput): NowcastResult {
  const ensembleTemp: number | null = input.hourlyTemperatureC[input.nowIndex] ?? null
  const ensemblePrecip: number | null = input.hourlyPrecipitationMm[input.nowIndex] ?? null
  const station = input.station
  const freshnessMs = input.freshnessMs ?? 90 * 60 * 1000
  const obsWeight = clamp01(input.observationWeight ?? 0.6)
  const nowMs = input.nowMs ?? Date.now()

  if (!station) {
    return {
      temperatureC: ensembleTemp,
      precipitationMm: ensemblePrecip,
      observationDeltaC: null,
      freshness: 'unavailable',
      station: null,
    }
  }
  const observationAgeMs = Math.abs(nowMs - station.observedAt)
  const freshness: NowcastResult['freshness'] =
    observationAgeMs > freshnessMs ? 'stale' : 'fresh'

  // Stale observations are still useful for the "real-world anchor"
  // but we lower the weight so a 3-hour-old AEMET reading doesn't
  // pull the ensemble too strongly.
  const effectiveObsWeight = freshness === 'stale' ? obsWeight * 0.5 : obsWeight

  if (freshness === 'stale') {
    // A stale obs still beats no obs, but we hand off primary trust to
    // the ensemble.
    return {
      temperatureC: ensembleTemp,
      precipitationMm: ensemblePrecip,
      observationDeltaC: station.temperatureC !== null && ensembleTemp !== null
        ? station.temperatureC - ensembleTemp
        : null,
      freshness,
      station,
    }
  }

  const obsTemp = station.temperatureC
  let temperatureC: number | null
  let observationDeltaC: number | null
  if (obsTemp !== null && ensembleTemp !== null) {
    temperatureC = effectiveObsWeight * obsTemp + (1 - effectiveObsWeight) * ensembleTemp
    observationDeltaC = obsTemp - ensembleTemp
  } else if (obsTemp !== null) {
    temperatureC = obsTemp
    observationDeltaC = null
  } else {
    temperatureC = ensembleTemp
    observationDeltaC = null
  }

  // Precip blending: same rule as temperature, except the
  // observation weight is lower (rain is a fast-changing signal
  // and a 10-min AEMET reading is already "old" for the
  // precipitation cell). The previous build hard-coded `obsPrecip`
  // to `null` so the nowcast's rain field always equalled the
  // ensemble, which meant a 5-km-away AEMET station showing 4
  // mm/h was ignored. We now read the station's `precipitationMm`
  // and apply the same convex combination with a smaller weight.
  const obsPrecip = station.precipitationMm
  const precipWeight = clamp01(0.3) // rain: ensemble-leaning
  let precipitationMm: number | null
  if (obsPrecip !== null && ensemblePrecip !== null) {
    precipitationMm = precipWeight * obsPrecip + (1 - precipWeight) * ensemblePrecip
  } else if (obsPrecip !== null) {
    precipitationMm = obsPrecip
  } else {
    precipitationMm = ensemblePrecip
  }

  return {
    temperatureC,
    precipitationMm,
    observationDeltaC,
    freshness,
    station,
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0.6
  return Math.max(0, Math.min(1, value))
}

/**
 * Picks the closest fresh station across the union of AEMET,
 * Meteocat and Meteoclimatic responses. All sources contribute
 * temperature, but AEMET supplies the freshest timestamps; Meteocat
 * is comparable; Meteoclimatic lags by 15-30 min and is only used as a
 * last resort. Returned distances are in km.
 */
export function pickClosestStation(
  sources: Array<{ source: StationObservation['source']; stations: StationObservation[] }>,
  userLat: number,
  userLon: number,
  now: number = Date.now(),
  maxAgeMs: number = 6 * 60 * 60 * 1000,
): StationObservation | null {
  let best: StationObservation | null = null
  for (const { stations } of sources) {
    for (const s of stations) {
      const age = Math.abs(now - s.observedAt)
      if (age > maxAgeMs) continue
      const distance = haversineKm([userLat, userLon], [s.lat, s.lon])
      if (best === null || distance < best.distanceKm) {
        best = { ...s, distanceKm: distance }
      }
    }
  }
  return best
}

/**
 * Map a MeteoclimaticObservation (the shape returned by the
 * station routes) to a `StationObservation` so it can be fed
 * into `pickClosestStation` / `blendNowcast`. Returns `null`
 * when the observation lacks a coordinate pair — those rows are
 * impossible to geolocate, so the nowcast cannot use them.
 *
 * The conversion preserves the precipitation field that the
 * previous build dropped, which the nowcast needs to ground
 * its "rain" cell.
 */
export function meteoclimaticToStationObservation(
  m: MeteoclimaticObservation,
  source: StationObservation['source'] = 'meteoclimatic',
): StationObservation | null {
  if (typeof m.lat !== 'number' || typeof m.lon !== 'number') return null
  const observedAtRaw = m.updatedAt
  const observedAtMs = observedAtRaw ? Date.parse(observedAtRaw) : NaN
  return {
    id: m.code,
    source,
    lat: m.lat,
    lon: m.lon,
    distanceKm: 0, // recomputed by pickClosestStation
    observedAt: Number.isFinite(observedAtMs) ? observedAtMs : 0,
    temperatureC: m.temperature?.current ?? null,
    humidityPct: m.humidity?.current ?? null,
    pressureHpa: m.pressure?.current ?? null,
    windKmh: m.wind?.speed ?? null,
    windDirDeg: m.wind?.bearing ?? null,
    precipitationMm: m.precipitation ?? null,
  }
}

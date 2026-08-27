/**
 * Terrain classification for weather forecast locations.
 * Classifies a location as coastal, mountain, urban, flat, island, or river_valley
 * based on elevation, distance to coast, and geographic heuristics.
 */

import { fetchWithTimeout } from '@/lib/fetchWithTimeout'
import type { TerrainType } from './config'

export interface TerrainClassification {
  type: TerrainType
  confidence: number
  elevation: number // meters
  distanceToCoast?: number // km
}

const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation'

/**
 * Fetch elevation from Open-Meteo's Elevation API.
 * Supports multiple coordinates in a single request.
 */
async function fetchElevation(lat: number, lon: number): Promise<number> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
  })
  const res = await fetchWithTimeout(`${ELEVATION_API}?${params}`, {
    timeoutMs: 5000,
  })
  if (!res.ok) return 0
  const data = await res.json()
  const elevations = data.elevation
  return Array.isArray(elevations) ? (elevations[0] ?? 0) : 0
}

/**
 * Approximate distance to coast using a simple heuristic.
 * This is a rough estimate based on the nearest known coastline.
 * For production, consider using a proper geospatial dataset.
 */
function estimateDistanceToCoast(lat: number, lon: number): number {
  // Known coastal reference points (simplified).
  // IMPORTANTE (auditoría F2/B9): NUNCA incluir ciudades interiores
  // (p. ej. París/Londres) como "costa" — clasificaría el interior como
  // coastal y distorsionaría los pesos por terreno. Solo puntos que
  // están realmente junto al mar.
  const coastRefs = [
    // Mediterranean
    { lat: 41.39, lon: 2.17 }, // Barcelona
    { lat: 43.30, lon: 5.37 }, // Marseille
    { lat: 40.85, lon: 14.27 }, // Naples
    { lat: 37.98, lon: 23.73 }, // Athens
    { lat: 38.72, lon: -9.14 }, // Lisbon
    // Atlantic (Europe)
    { lat: 43.26, lon: -2.93 }, // Bilbao
    { lat: 43.54, lon: -5.66 }, // Gijón
    { lat: 55.68, lon: 12.57 }, // Copenhagen
    { lat: 59.33, lon: 18.07 }, // Stockholm
    { lat: 60.17, lon: 24.94 }, // Helsinki
    // Atlantic (Americas)
    { lat: 40.71, lon: -74.01 }, // New York
    { lat: 34.05, lon: -118.24 }, // Los Angeles
    { lat: 25.76, lon: -80.19 }, // Miami
    { lat: 49.28, lon: -123.12 }, // Vancouver
  ]

  let minDist = Infinity
  for (const ref of coastRefs) {
    const d = haversineSimple(lat, lon, ref.lat, ref.lon)
    if (d < minDist) minDist = d
  }
  return minDist
}

function haversineSimple(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Simple island detection based on known island coordinates.
 * Covers major islands in the app's target regions.
 */
function isIsland(lat: number, lon: number): boolean {
  const islands = [
    // Balearic Islands
    { lat: 39.57, lon: 2.65, r: 80 }, // Mallorca
    { lat: 38.99, lon: 1.43, r: 40 }, // Ibiza
    { lat: 39.98, lon: 3.10, r: 30 }, // Menorca
    // Canary Islands
    { lat: 28.10, lon: -15.41, r: 80 }, // Gran Canaria
    { lat: 28.29, lon: -16.63, r: 80 }, // Tenerife
    { lat: 28.04, lon: -18.00, r: 40 }, // La Palma
    { lat: 29.03, lon: -13.63, r: 30 }, // Lanzarote
    { lat: 28.37, lon: -14.10, r: 30 }, // Fuerteventura
    // Corsica / Sardinia
    { lat: 42.15, lon: 9.09, r: 80 }, // Corsica
    { lat: 39.22, lon: 9.12, r: 120 }, // Sardinia
    // Sicily
    { lat: 37.60, lon: 14.02, r: 100 }, // Sicily
    // Crete
    { lat: 35.24, lon: 24.90, r: 80 }, // Crete
    // Cyprus
    { lat: 35.13, lon: 33.43, r: 80 }, // Cyprus
    // UK/Ireland
    { lat: 54.60, lon: -5.93, r: 100 }, // N. Ireland
    { lat: 55.95, lon: -3.19, r: 200 }, // Scotland
    // Iceland
    { lat: 64.15, lon: -21.94, r: 200 }, // Iceland
    // Caribbean
    { lat: 18.47, lon: -66.11, r: 100 }, // Puerto Rico
    { lat: 18.49, lon: -69.93, r: 120 }, // Dominican Republic
    { lat: 23.11, lon: -82.37, r: 100 }, // Cuba
    // Japan
    { lat: 35.68, lon: 139.69, r: 200 }, // Honshu
    { lat: 43.06, lon: 141.35, r: 100 }, // Hokkaido
    { lat: 33.59, lon: 130.40, r: 100 }, // Kyushu
  ]

  for (const island of islands) {
    if (haversineSimple(lat, lon, island.lat, island.lon) < island.r) {
      return true
    }
  }
  return false
}

/**
 * Check if a location is near a major river valley.
 */
function isNearRiverValley(lat: number, lon: number): boolean {
  const rivers = [
    // Ebro (Spain)
    { lat: 41.65, lon: -0.88, r: 50 },
    // Guadalquivir (Spain)
    { lat: 37.39, lon: -6.00, r: 50 },
    // Tajo/Tagus (Spain/Portugal)
    { lat: 39.93, lon: -6.86, r: 50 },
    // Rhône (France)
    { lat: 45.76, lon: 4.84, r: 50 },
    // Danube (Europe)
    { lat: 48.21, lon: 16.37, r: 50 },
    // Mississippi (US)
    { lat: 29.76, lon: -95.37, r: 80 },
    // Columbia (US)
    { lat: 45.52, lon: -122.68, r: 50 },
    // Rio Grande
    { lat: 25.69, lon: -100.32, r: 50 },
    // Paraná (Argentina)
    { lat: -34.60, lon: -58.38, r: 80 },
  ]

  for (const river of rivers) {
    if (haversineSimple(lat, lon, river.lat, river.lon) < river.r) {
      return true
    }
  }
  return false
}

/**
 * Urban detection based on a set of known metropolitan areas. This is a
 * rough heuristic; a proper implementation would use a population/land
 * use dataset. Only high-population metro cores are listed so that
 * nearby suburbs/outskirts don't get mislabelled.
 */
function isUrban(lat: number, lon: number): boolean {
  const metros = [
    // Iberia
    { lat: 40.42, lon: -3.70, r: 45 }, // Madrid
    { lat: 41.39, lon: 2.17, r: 35 }, // Barcelona (urbano, aunque costero)
    { lat: 37.39, lon: -6.00, r: 25 }, // Sevilla
    // Europe
    { lat: 48.86, lon: 2.35, r: 45 }, // Paris
    { lat: 51.51, lon: -0.13, r: 45 }, // London
    { lat: 52.52, lon: 13.41, r: 40 }, // Berlin
    { lat: 48.14, lon: 11.58, r: 30 }, // Munich
    { lat: 41.90, lon: 12.50, r: 35 }, // Rome
    { lat: 45.46, lon: 9.19, r: 35 }, // Milan
    { lat: 52.37, lon: 4.90, r: 35 }, // Amsterdam
    { lat: 50.85, lon: 4.35, r: 30 }, // Brussels
    { lat: 48.21, lon: 16.37, r: 30 }, // Vienna
    { lat: 50.08, lon: 14.44, r: 30 }, // Prague
    { lat: 52.23, lon: 21.01, r: 35 }, // Warsaw
    // Americas / elsewhere
    { lat: 40.71, lon: -74.01, r: 50 }, // New York
    { lat: 34.05, lon: -118.24, r: 50 }, // Los Angeles
    { lat: 41.88, lon: -87.63, r: 50 }, // Chicago
  ]
  for (const m of metros) {
    if (haversineSimple(lat, lon, m.lat, m.lon) < m.r) return true
  }
  return false
}

/**
 * Classify a location's terrain type.
 * Uses elevation API + geographic heuristics.
 */
export async function classifyTerrain(
  lat: number,
  lon: number
): Promise<TerrainClassification> {
  const elevation = await fetchElevation(lat, lon)
  const distanceToCoast = estimateDistanceToCoast(lat, lon)

  // Island check (highest priority for island classification)
  if (isIsland(lat, lon)) {
    return { type: 'island', confidence: 0.9, elevation, distanceToCoast }
  }

  // Coastal: < 10km from coast and low elevation
  if (distanceToCoast < 10 && elevation < 200) {
    return { type: 'coastal', confidence: 0.85, elevation, distanceToCoast }
  }

  // Mountain: elevation > 1000m
  if (elevation > 1000) {
    return { type: 'mountain', confidence: 0.8, elevation, distanceToCoast }
  }

  // River valley: near a major river
  if (isNearRiverValley(lat, lon) && elevation < 500) {
    return { type: 'river_valley', confidence: 0.7, elevation, distanceToCoast }
  }

  // Urban: known metropolitan core (was previously unreachable — the
  // classifier never returned 'urban', so profiles.ts's urban branch was
  // dead code).
  if (isUrban(lat, lon)) {
    return { type: 'urban', confidence: 0.7, elevation, distanceToCoast }
  }

  // Flat: low elevation, far from coast
  if (elevation < 200 && distanceToCoast > 10) {
    return { type: 'flat', confidence: 0.6, elevation, distanceToCoast }
  }

  // Default: flat
  return { type: 'flat', confidence: 0.5, elevation, distanceToCoast }
}

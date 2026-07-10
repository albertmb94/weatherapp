import type { WeatherModel } from './models'

/**
 * Detect which geographic region a location belongs to based on coordinates.
 * Used to prioritize regional high-res models for the user's area.
 */
export type Region = 'global' | 'europe' | 'namerica' | 'asia' | 'oceania'

export function getRegionForLocation(lat: number, lon: number): Region {
  // Europe: 25-71°N, -30-45°E (includes Canary Islands, Azores, Madeira)
  if (lat >= 25 && lat <= 71 && lon >= -30 && lon <= 45) return 'europe'
  // North America: 15-72°N, -170--50°E
  if (lat >= 15 && lat <= 72 && lon >= -170 && lon <= -50) return 'namerica'
  // Asia: 0-65°N, 40-180°E
  if (lat >= 0 && lat <= 65 && lon >= 40 && lon <= 180) return 'asia'
  // Oceania: -50-0°S, 110-180°E
  if (lat >= -50 && lat <= 0 && lon >= 110 && lon <= 180) return 'oceania'
  return 'global'
}

/**
 * Select the best models for a given location and forecast horizon.
 * Priority: region-specific high-res models + global models + AI models.
 * Falls back to all available models if the location is outside known regions.
 */
export function selectModelsForLocation(
  allModels: WeatherModel[],
  lat: number,
  lon: number,
  forecastDays?: number
): WeatherModel[] {
  const region = getRegionForLocation(lat, lon)
  const landModels = allModels.filter(m => m.id !== 'marine_global')

  // Split into tiers
  const regional = landModels.filter(m => m.region === region)
  const global = landModels.filter(m => m.region === 'global' && m.type !== 'ai')
  const ai = landModels.filter(m => m.type === 'ai')

  // Ensure at least one global model covers the requested horizon
  const selected: WeatherModel[] = []
  const selectedIds = new Set<string>()

  function add(m: WeatherModel) {
    if (!selectedIds.has(m.id)) {
      selected.push(m)
      selectedIds.add(m.id)
    }
  }

  // 1. Regional models first (highest resolution for this area)
  for (const m of regional.sort((a, b) => (a.resolution ?? 99) - (b.resolution ?? 99))) {
    add(m)
  }

  // 2. Global models (always include top ones by weight)
  for (const m of global.sort((a, b) => b.weight - a.weight)) {
    add(m)
  }

  // 3. AI models (test accuracy)
  for (const m of ai.sort((a, b) => b.weight - a.weight)) {
    add(m)
  }

  // 4. If requested horizon exceeds what selected models can provide,
  //    add any remaining long-range models
  if (forecastDays !== undefined) {
    const requiredHours = forecastDays * 24
    for (const m of landModels) {
      if (m.maxHours >= requiredHours && !selectedIds.has(m.id)) {
        add(m)
      }
    }
  }

  return selected
}

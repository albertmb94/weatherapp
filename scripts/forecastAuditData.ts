import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { BACKTEST_LOCATIONS } from '../lib/backtest/config'
import { fetchPreviousRuns } from '../lib/backtest/fetchPreviousRuns'
import { fetchERA5Observations } from '../lib/backtest/fetchERA5'
import { buildForecastRequest, DEFAULT_FORECAST_DAYS } from '../lib/openMeteo'
import { MODELS, METRICS } from '../lib/models'
import { fetchWithTimeout } from '../lib/fetchWithTimeout'

export const trainingNames = [
  'Barcelona', 'Madrid', 'Valencia', 'Bilbao', 'Granada', 'Palma', 'Sevilla', 'Valladolid',
  'Paris', 'London', 'Berlin', 'Amsterdam', 'Rome', 'Zurich', 'New York', 'Chicago', 'Los Angeles', 'Toronto',
]
export const holdoutNames = [
  'Málaga', 'Zaragoza', 'Cuenca', 'Lisbon', 'Munich', 'Copenhagen',
  'Denver', 'Phoenix', 'Seattle', 'Vancouver', 'Montreal', 'Mexico City',
]
export const metrics = ['temperature', 'precipitation', 'wind_speed']
export const archiveDir = '.recalibration-cache'
export const spatialWindow = { from: '2026-10-19', to: '2026-11-01' }
export const recentWindow = { from: '2026-11-02', to: '2026-11-05' }

export function archivePath(name: string, from: string, to: string): string {
  return `${archiveDir}/audit-v3-${encodeURIComponent(name)}-${from}-${to}.json.gz`
}

async function collect() {
  mkdirSync(archiveDir, { recursive: true })
  const elevationPath = `${archiveDir}/audit-elevations.json`
  if (!existsSync(elevationPath)) {
    const locations = BACKTEST_LOCATIONS.filter(location => [...trainingNames, ...holdoutNames].includes(location.name))
    const params = new URLSearchParams({
      latitude: locations.map(location => location.lat).join(','),
      longitude: locations.map(location => location.lon).join(','),
    })
    const response = await fetchWithTimeout(`https://api.open-meteo.com/v1/elevation?${params}`)
    if (!response.ok) throw new Error(`Elevation archive: ${response.status}`)
    const { elevation } = await response.json()
    if (!Array.isArray(elevation) || elevation.length !== locations.length || elevation.some(value => !Number.isFinite(value))) {
      throw new Error('Incomplete elevation archive')
    }
    writeFileSync(elevationPath, JSON.stringify(Object.fromEntries(locations.map((location, index) => [location.name, elevation[index]]))))
  }
  const windows = [
    { names: holdoutNames, ...spatialWindow },
    { names: trainingNames, ...recentWindow },
  ]
  let failed = false
  for (const { names, from, to } of windows) {
    for (const name of names) {
      const location = BACKTEST_LOCATIONS.find(item => item.name === name)
      if (!location) throw new Error(`Unknown location: ${name}`)
      const path = archivePath(name, from, to)
      if (existsSync(path)) continue
      const { capped } = buildForecastRequest(location.lat, location.lon, MODELS, METRICS, DEFAULT_FORECAST_DAYS)
      try {
        const forecast = await fetchPreviousRuns(location, from, to, undefined, { metrics, modelIds: capped.map(m => m.id) })
        const observations = await fetchERA5Observations(location, from, to, undefined, metrics)
        if (!forecast.length || !observations.length) throw new Error('Empty archive or reference series')
        writeFileSync(path, gzipSync(JSON.stringify({ forecast, observations })))
        console.log(`[archive] ${name} ${from}..${to}: ${forecast.length} forecasts, ${observations.length} observations`)
      } catch (error) {
        failed = true
        console.error(`[archive] ${name} ${from}..${to}:`, error)
      }
      await new Promise(resolve => setTimeout(resolve, 2200))
    }
  }
  if (failed) process.exitCode = 1
}

if (process.argv.includes('--download')) void collect().catch(error => {
  console.error(error)
  process.exitCode = 1
})

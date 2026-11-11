import { existsSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fetchPreviousRuns } from '../lib/backtest/fetchPreviousRuns'
import { fetchXemaObservations } from '../lib/backtest/fetchStations'
import { buildForecastRequest, DEFAULT_FORECAST_DAYS } from '../lib/openMeteo'
import { METRICS, MODELS } from '../lib/models'
import { readRainArchive } from './rainTargetData'
import type { StationObservationRow } from '../lib/backtest/db'

export const fitStations = ['WU', 'X4', 'WT', 'C6', 'CW', 'DJ', 'VY', 'XZ', 'YL']
export const spatialStations = ['UJ', 'MS', 'V8', 'WM', 'XJ']
export const fitStart = '2026-09-01'
export const fitEnd = '2026-10-10'
export const offsets = [1, 2, 3, 7]
export const observationFile = `xema-ensemble-rain-${fitStart}-${fitEnd}.json.gz`
export const forecastFile = (id: string) => `ensemble-rain-${id}-${fitStart}-2026-10-18.json.gz`
const dir = '.recalibration-cache'

async function collect() {
  const key = process.env.METEOCAT_API_KEY
  if (!existsSync(`${dir}/${observationFile}`)) {
    if (!key) throw new Error('METEOCAT_API_KEY missing')
    const observations = (await fetchXemaObservations(fitStart, fitEnd, key, ['precipitation'], undefined, console.log))
      .filter(row => fitStations.includes(row.station_id))
    if (new Set(observations.map(row => row.valid_time.slice(0, 10))).size < 36) throw new Error('Incomplete station window')
    writeFileSync(`${dir}/${observationFile}`, gzipSync(JSON.stringify(observations)))
  }
  const observations = readRainArchive<StationObservationRow[]>(observationFile)
  let failed = false
  for (const id of fitStations) {
    const path = `${dir}/${forecastFile(id)}`
    if (existsSync(path)) continue
    const station = observations.find(row => row.station_id === id)
    if (!station) throw new Error(`No observations for ${id}`)
    const { lat, lon } = station
    const { capped } = buildForecastRequest(lat, lon, MODELS, METRICS, DEFAULT_FORECAST_DAYS)
    try {
      const rows = await fetchPreviousRuns({ name: id, lat, lon, terrain: 'coastal', country: 'ES' },
        fitStart, '2026-10-18', undefined, { metrics: ['precipitation'], modelIds: capped.map(m => m.id), leadDays: offsets })
      if (rows.length === 0) throw new Error('Empty forecasts')
      writeFileSync(path, gzipSync(JSON.stringify(rows)))
      console.log('[archive]', id, rows.length)
    } catch (error) {
      failed = true
      console.error('[archive]', id, error)
    }
  }
  if (failed) process.exitCode = 1
}
if (process.argv.includes('--download')) void collect().catch(error => { console.error(error); process.exitCode = 1 })

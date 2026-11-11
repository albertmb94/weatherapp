import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import { fetchXemaObservations } from '../lib/backtest/fetchStations'
import { fetchPreviousRuns } from '../lib/backtest/fetchPreviousRuns'
import type { StationObservationRow, ForecastArchiveRow } from '../lib/backtest/db'
import { buildForecastRequest, DEFAULT_FORECAST_DAYS } from '../lib/openMeteo'
import { METRICS, MODELS } from '../lib/models'

const dir = '.recalibration-cache'
export const fitFrom = '2026-09-12'
export const fitThrough = '2026-10-10'
export const stations = ['WU', 'X4', 'WT']
const observationPath = `${dir}/xema-rain-v4-${fitFrom}-${fitThrough}.json.gz`
export function readRainArchive<T>(path: string): T {
  return JSON.parse(gunzipSync(readFileSync(`${dir}/${path}`)).toString())
}
export const trainingObservationFile = observationPath.slice(dir.length + 1)
export const trainingForecastFile = (id: string) => `coast-rain-v4-${id}-${fitFrom}-${fitThrough}.json.gz`

async function collect() {
  let observed: StationObservationRow[]
  if (existsSync(observationPath)) observed = readRainArchive(trainingObservationFile)
  else {
    const apiKey = process.env.METEOCAT_API_KEY
    if (!apiKey) throw new Error('METEOCAT_API_KEY missing')
    observed = (await fetchXemaObservations(fitFrom, fitThrough, apiKey, ['precipitation'], undefined, console.log))
      .filter(row => stations.includes(row.station_id))
    if (!observed.length) throw new Error('No complete validated XEMA observations')
    writeFileSync(observationPath, gzipSync(JSON.stringify(observed)))
  }
  for (const id of stations) {
    const path = `${dir}/${trainingForecastFile(id)}`
    if (existsSync(path)) continue
    const station = observed.find(row => row.station_id === id)
    if (!station) throw new Error(`Missing station ${id}`)
    const { lat, lon } = station
    const { capped } = buildForecastRequest(lat, lon, MODELS, METRICS, DEFAULT_FORECAST_DAYS)
    const rows: ForecastArchiveRow[] = await fetchPreviousRuns({ name: id, lat, lon, country: 'ES', terrain: 'coastal' },
      fitFrom, fitThrough, undefined, { metrics: ['precipitation'], modelIds: capped.map(model => model.id) })
    if (!rows.length) throw new Error(`Empty forecast archive for ${id}`)
    writeFileSync(path, gzipSync(JSON.stringify(rows)))
    console.log(id, rows.length)
  }
}
if (process.argv.includes('--download')) void collect().catch(error => { console.error(error); process.exitCode = 1 })

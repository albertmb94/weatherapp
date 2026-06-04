import type { MeteoclimaticObservation } from './meteoclimatic-types'

const DIRECTIONS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

function bearingToDirection(bearing: number): string {
  const index = Math.round(bearing / 22.5) % 16
  return DIRECTIONS[index]
}

function parseCommaFloat(s: string): number | null {
  const cleaned = s.trim().replace(',', '.')
  if (cleaned === '' || cleaned === '_' || cleaned === '-') return null
  const val = parseFloat(cleaned)
  return isNaN(val) ? null : val
}

function parseItem(item: string): MeteoclimaticObservation | null {
  const titleMatch = item.match(/<title>(.*?)<\/title>/)
  const pointMatch = item.match(/<georss:point>(.*?)<\/georss:point>/)
  const dateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/)
  const dataMatch = item.match(/\[\[<([A-Za-z0-9]+;\(.*?)>\]\]/)

  if (!dataMatch) return null

  const raw = dataMatch[1]
  const parts = raw.match(/^([^;(]+);\(([^)]*)\);\(([^)]*)\);\(([^)]*)\);\(([^)]*)\);\(([^)]*)\);(.*)$/)
  if (!parts) return null

  const tempParts = parts[2].split(';')
  const humParts = parts[3].split(';')
  const pressParts = parts[4].split(';')
  const windParts = parts[5].split(';')
  const precipParts = parts[6].split(';')

  let lat = 0
  let lon = 0
  if (pointMatch) {
    const coords = pointMatch[1].split(/\s+/)
    lat = parseFloat(coords[0])
    lon = parseFloat(coords[1])
  }

  const tempCurr = parseCommaFloat(tempParts[0])
  const humCurr = parseCommaFloat(humParts[0])
  const pressCurr = parseCommaFloat(pressParts[0])
  const windSpeed = parseCommaFloat(windParts[0])
  const windGust = parseCommaFloat(windParts[1])
  const windBearing = parseCommaFloat(windParts[2])

  return {
    code: parts[1],
    name: parts[7]?.trim() || titleMatch?.[1]?.trim() || parts[1],
    lat,
    lon,
    updatedAt: dateMatch?.[1]?.trim() || '',
    temperature: {
      current: tempCurr,
      max: parseCommaFloat(tempParts[1]),
      min: parseCommaFloat(tempParts[2]),
    },
    condition: tempParts[3]?.trim() || '',
    humidity: {
      current: humCurr,
      max: parseCommaFloat(humParts[1]),
      min: parseCommaFloat(humParts[2]),
    },
    pressure: {
      current: pressCurr,
      max: parseCommaFloat(pressParts[1]),
      min: parseCommaFloat(pressParts[2]),
    },
    wind: {
      speed: windSpeed,
      gust: windGust,
      bearing: windBearing,
      direction: windBearing !== null ? bearingToDirection(windBearing) : '',
    },
    precipitation: parseCommaFloat(precipParts[0]),
  }
}

export function parseRss(xml: string): MeteoclimaticObservation[] {
  const stations: MeteoclimaticObservation[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const station = parseItem(match[1])
    if (station) stations.push(station)
  }

  return stations
}

export async function fetchStationData(stationCode: string): Promise<MeteoclimaticObservation[]> {
  const url = `https://meteoclimatic.net/feed/rss/${stationCode}`

  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })

  if (!response.ok) {
    throw new Error(`Meteoclimatic fetch failed: ${response.status}`)
  }

  const xml = await response.text()

  return parseRss(xml)
}

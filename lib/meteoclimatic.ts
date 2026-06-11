import type { MeteoclimaticObservation } from './meteoclimatic-types'

const DIRECTIONS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

function decodeEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

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

  // B13: stations without a <georss:point> used to be parsed with lat/lon = 0
  // ("Null Island"). They were hidden by chance by the region bbox filter;
  // once we filter by proximity they would surface with fake distances.
  // Discard them here so callers can skip them.
  if (!pointMatch) return null
  const coords = pointMatch[1].split(/\s+/)
  const lat = parseFloat(coords[0])
  const lon = parseFloat(coords[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  const tempCurr = parseCommaFloat(tempParts[0])
  const humCurr = parseCommaFloat(humParts[0])
  const pressCurr = parseCommaFloat(pressParts[0])
  const windSpeed = parseCommaFloat(windParts[0])
  const windGust = parseCommaFloat(windParts[1])
  const windBearing = parseCommaFloat(windParts[2])

  return {
    code: parts[1],
    name: decodeEntities(parts[7]?.trim()) || decodeEntities(titleMatch?.[1]?.trim() || '') || parts[1],
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

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'application/xml+rss,text/xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Referer': 'https://www.meteoclimatic.net/',
    },
  })

  if (!response.ok) {
    throw new Error(`Meteoclimatic fetch failed: ${response.status}`)
  }

  const xml = await response.text()

  return parseRss(xml)
}

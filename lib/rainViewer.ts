export interface RainviewerFrame {
  path: string
  time: number
}

export interface RainviewerData {
  host: string
  past: RainviewerFrame[]
  nowcast: RainviewerFrame[]
}

interface RainviewerApiResponse {
  host?: string
  radar?: {
    past?: RainviewerFrame[]
    nowcast?: RainviewerFrame[]
  }
}

const RAINVIEWER_URL = 'https://api.rainviewer.com/public/weather-maps.json'

export async function fetchRainviewerFrames(signal?: AbortSignal): Promise<RainviewerData> {
  const res = await fetch(RAINVIEWER_URL, { signal })
  if (!res.ok) throw new Error(`RainViewer ${res.status}`)
  const data = (await res.json()) as RainviewerApiResponse
  return {
    host: data.host ?? 'https://tilecache.rainviewer.com',
    past: data.radar?.past ?? [],
    nowcast: data.radar?.nowcast ?? [],
  }
}

export function buildRadarTileUrl(
  host: string,
  path: string,
  options: { size?: 256 | 512; color?: number; smooth?: 0 | 1; snow?: 0 | 1 } = {}
): string {
  const size = options.size ?? 256
  const color = options.color ?? 2
  const smooth = options.smooth ?? 1
  const snow = options.snow ?? 1
  return `${host}${path}/${size}/{z}/{x}/{y}/${color}/${smooth}_${snow}.png`
}

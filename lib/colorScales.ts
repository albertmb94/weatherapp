import type { MetricId } from './models'

export type ScaleMetric = Exclude<MetricId, 'all'>

export interface ColorStop {
  value: number
  color: [number, number, number]
}

export const SCALES: Record<ScaleMetric, ColorStop[]> = {
  temperature: [
    { value: -20, color: [30, 0, 100] },
    { value: 0, color: [0, 180, 255] },
    { value: 15, color: [0, 200, 80] },
    { value: 25, color: [255, 255, 0] },
    { value: 35, color: [255, 60, 0] },
    { value: 45, color: [150, 0, 150] },
  ],
  cloud_cover: [
    { value: 0, color: [255, 255, 180] },
    { value: 50, color: [180, 180, 180] },
    { value: 100, color: [60, 60, 60] },
  ],
  wind_speed: [
    { value: 0, color: [0, 180, 0] },
    { value: 20, color: [255, 255, 0] },
    { value: 40, color: [255, 140, 0] },
    { value: 60, color: [255, 0, 0] },
    { value: 100, color: [150, 0, 150] },
  ],
  wind_gusts: [
    { value: 0, color: [0, 200, 0] },
    { value: 30, color: [255, 255, 0] },
    { value: 60, color: [255, 140, 0] },
    { value: 90, color: [255, 0, 0] },
    { value: 140, color: [150, 0, 150] },
  ],
  precipitation: [
    { value: 0, color: [255, 255, 255] },
    { value: 0.5, color: [100, 200, 255] },
    { value: 2, color: [0, 80, 200] },
    { value: 5, color: [120, 0, 200] },
    { value: 10, color: [200, 0, 0] },
  ],
  humidity: [
    { value: 0, color: [255, 200, 100] },
    { value: 30, color: [180, 210, 50] },
    { value: 50, color: [100, 180, 100] },
    { value: 70, color: [50, 100, 150] },
    { value: 100, color: [20, 40, 100] },
  ],
  uv_index: [
    { value: 0, color: [100, 200, 100] },
    { value: 3, color: [255, 255, 100] },
    { value: 6, color: [255, 150, 50] },
    { value: 8, color: [255, 60, 60] },
    { value: 11, color: [180, 40, 150] },
  ],
  pressure: [
    { value: 980, color: [100, 0, 200] },
    { value: 1000, color: [0, 100, 255] },
    { value: 1013, color: [0, 200, 100] },
    { value: 1025, color: [255, 200, 0] },
    { value: 1045, color: [255, 60, 0] },
  ],
  dewpoint: [
    { value: -10, color: [200, 200, 255] },
    { value: 5, color: [100, 200, 100] },
    { value: 15, color: [255, 255, 100] },
    { value: 25, color: [255, 100, 50] },
  ],
  visibility: [
    { value: 0, color: [200, 0, 0] },
    { value: 2, color: [255, 150, 0] },
    { value: 5, color: [255, 255, 0] },
    { value: 15, color: [0, 200, 100] },
    { value: 30, color: [0, 150, 255] },
  ],
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpColor(c1: [number, number, number], c2: [number, number, number], t: number): [number, number, number] {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]
}

export function getColor(metric: MetricId, value: number | null): string {
  if (value === null || value === undefined) return '#2a2a2a'
  const scaleMetric = metric === 'all' ? 'temperature' : metric
  const stops = SCALES[scaleMetric]
  if (value <= stops[0].value) {
    const [r, g, b] = stops[0].color
    return `rgb(${r},${g},${b})`
  }
  if (value >= stops[stops.length - 1].value) {
    const [r, g, b] = stops[stops.length - 1].color
    return `rgb(${r},${g},${b})`
  }
  for (let i = 0; i < stops.length - 1; i++) {
    if (value >= stops[i].value && value <= stops[i + 1].value) {
      const t = (value - stops[i].value) / (stops[i + 1].value - stops[i].value)
      const [r, g, b] = lerpColor(stops[i].color, stops[i + 1].color, t)
      return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
    }
  }
  return '#2a2a2a'
}

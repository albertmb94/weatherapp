import { describe, it, expect } from 'vitest'

function sliceForecast(
  times: Date[],
  series: Record<string, Record<string, (number | null)[]>>,
  startIndex: number
): { times: Date[]; series: Record<string, Record<string, (number | null)[]>> } {
  const slicedTimes = times.slice(startIndex)
  const slicedSeries: Record<string, Record<string, (number | null)[]>> = {}
  for (const modelId of Object.keys(series)) {
    slicedSeries[modelId] = {}
    for (const metricId of Object.keys(series[modelId])) {
      slicedSeries[modelId][metricId] = series[modelId][metricId].slice(startIndex)
    }
  }
  return { times: slicedTimes, series: slicedSeries }
}

describe('sliceForecast', () => {
  const times = [new Date('2025-01-01T00:00:00Z'), new Date('2025-01-01T01:00:00Z'), new Date('2025-01-01T02:00:00Z')]
  const series = {
    gfs_global: {
      temperature: [10, 11, 12],
      wind_speed: [5, 6, 7],
    },
  }

  it('returns full data for startIndex 0', () => {
    const result = sliceForecast(times, series, 0)
    expect(result.times.length).toBe(3)
    expect(result.series.gfs_global.temperature).toEqual([10, 11, 12])
  })

  it('slices from given index', () => {
    const result = sliceForecast(times, series, 1)
    expect(result.times.length).toBe(2)
    expect(result.times[0]).toEqual(new Date('2025-01-01T01:00:00Z'))
    expect(result.series.gfs_global.temperature).toEqual([11, 12])
    expect(result.series.gfs_global.wind_speed).toEqual([6, 7])
  })

  it('slices all models and metrics', () => {
    const multiSeries = {
      gfs_global: { temperature: [10, 11, 12] },
      icon_global: { temperature: [11, 12, 13] },
    }
    const result = sliceForecast(times, multiSeries, 2)
    expect(result.series.gfs_global.temperature).toEqual([12])
    expect(result.series.icon_global.temperature).toEqual([13])
  })

  it('returns empty for startIndex beyond data', () => {
    const result = sliceForecast(times, series, 10)
    expect(result.times.length).toBe(0)
    expect(result.series.gfs_global.temperature.length).toBe(0)
  })
})

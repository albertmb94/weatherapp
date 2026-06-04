import { describe, it, expect } from 'vitest'
import { exportForecastCsv } from '../exportCsv'
import { MODELS, METRICS } from '../models'
import type { WeatherModel } from '../models'

describe('exportForecastCsv', () => {
  const testModels: WeatherModel[] = [
    { id: 'gfs_global', label: 'GFS 13km', color: '#f032e6', maxHours: 384, weight: 3 },
    { id: 'icon_global', label: 'ICON 13km', color: '#911eb4', maxHours: 240, weight: 4 },
  ]

  const times = [
    new Date('2025-01-01T00:00:00Z'),
    new Date('2025-01-01T01:00:00Z'),
    new Date('2025-01-01T02:00:00Z'),
  ]

  const series: Record<string, Record<string, (number | null)[]>> = {
    gfs_global: {
      temperature: [10, 11, 12],
      cloud_cover: [50, 60, 70],
      wind_speed: [5, 6, 7],
      wind_gusts: [10, 12, 14],
      precipitation: [0, 0.5, 1],
      humidity: [80, 75, 70],
      uv_index: [0, 1, 2],
      pressure: [1013, 1012, 1011],
      dewpoint: [5, 6, 7],
      visibility: [10, 9, 8],
    },
    icon_global: {
      temperature: [11, 12, 13],
      cloud_cover: [40, 50, 60],
      wind_speed: [4, 5, 6],
      wind_gusts: [8, 10, 12],
      precipitation: [0, 0.3, 0.8],
      humidity: [85, 80, 75],
      uv_index: [0, 0.5, 1.5],
      pressure: [1014, 1013, 1012],
      dewpoint: [6, 7, 8],
      visibility: [11, 10, 9],
    },
  }

  it('returns CSV with header row', () => {
    const csv = exportForecastCsv(testModels, times, series, 3)
    const lines = csv.split('\n')
    expect(lines[0]).toContain('Hour')
    expect(lines[0]).toContain('DateTime')
    expect(lines[0]).toContain('GFS 13km')
    expect(lines[0]).toContain('ICON 13km')
  })

  it('has correct number of data rows', () => {
    const csv = exportForecastCsv(testModels, times, series, 3)
    const lines = csv.split('\n')
    expect(lines.length).toBe(4) // header + 3 data rows
  })

  it('limits rows by maxHours', () => {
    const csv = exportForecastCsv(testModels, times, series, 2)
    const lines = csv.split('\n')
    expect(lines.length).toBe(3) // header + 2 data rows
  })

  it('handles null values as empty strings', () => {
    const sparseSeries: Record<string, Record<string, (number | null)[]>> = {
      gfs_global: {
        temperature: [10, null, 12],
        cloud_cover: [50, 60, 70],
        wind_speed: [5, 6, 7],
        wind_gusts: [10, 12, 14],
        precipitation: [0, 0.5, 1],
        humidity: [80, 75, 70],
        uv_index: [0, 1, 2],
        pressure: [1013, 1012, 1011],
        dewpoint: [5, 6, 7],
        visibility: [10, 9, 8],
      },
    }
    const csv = exportForecastCsv([testModels[0]], times, sparseSeries, 3)
    const lines = csv.split('\n')
    // Row 2 (index 2) has temperature=null at column index 2
    const rowWithNull = lines[2].split(',')
    // temperature is the first metric column after Hour,DateTime
    expect(rowWithNull[2]).toBe('') // null -> empty
    expect(rowWithNull[3]).toBe('60') // cloud_cover value present
  })

  it('handles empty times array', () => {
    const csv = exportForecastCsv(testModels, [], series, 7)
    const lines = csv.split('\n')
    expect(lines.length).toBe(1) // header only
  })

  it('handles single model', () => {
    const csv = exportForecastCsv([testModels[0]], times, series, 3)
    const lines = csv.split('\n')
    expect(lines[0]).toContain('GFS 13km')
    expect(lines[0]).not.toContain('ICON')
  })
})

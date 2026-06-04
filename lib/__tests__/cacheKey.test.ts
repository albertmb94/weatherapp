import { describe, it, expect } from 'vitest'
import { buildForecastCacheKey } from '../cacheKey'

describe('buildForecastCacheKey', () => {
  it('rounds lat/lon to 2 decimals', () => {
    const params = new URLSearchParams({
      latitude: '48.8566',
      longitude: '2.3522',
      hourly: 'temperature_2m',
      models: 'gfs_global',
      forecast_days: '7',
    })
    const key = buildForecastCacheKey(params)
    expect(key).toContain('latitude=48.86')
    expect(key).toContain('longitude=2.35')
  })

  it('sorts params alphabetically', () => {
    const params = new URLSearchParams({
      models: 'gfs_global',
      hourly: 'temperature_2m',
      forecast_days: '7',
    })
    const key = buildForecastCacheKey(params)
    const parts = key.split('|')
    const keys = parts.map(p => p.split('=')[0])
    expect(keys).toEqual([...keys].sort())
  })

  it('skips timezone param', () => {
    const params1 = new URLSearchParams({
      hourly: 'temperature_2m',
      timezone: 'auto',
    })
    const params2 = new URLSearchParams({
      hourly: 'temperature_2m',
    })
    expect(buildForecastCacheKey(params1)).toBe(buildForecastCacheKey(params2))
  })

  it('sorts multi-location lat/lon pairs as a set', () => {
    const params1 = new URLSearchParams({
      latitude: '48.86,52.52',
      longitude: '2.35,13.41',
      hourly: 'temperature_2m',
    })
    const params2 = new URLSearchParams({
      latitude: '52.52,48.86',
      longitude: '13.41,2.35',
      hourly: 'temperature_2m',
    })
    expect(buildForecastCacheKey(params1)).toBe(buildForecastCacheKey(params2))
  })

  it('returns empty string for empty params', () => {
    expect(buildForecastCacheKey(new URLSearchParams())).toBe('')
  })

  it('produces consistent keys for same inputs', () => {
    const params = new URLSearchParams({
      latitude: '40.7128',
      longitude: '-74.0060',
      hourly: 'wind_speed_10m',
      models: 'icon_global',
      forecast_days: '3',
    })
    const key1 = buildForecastCacheKey(params)
    const key2 = buildForecastCacheKey(params)
    expect(key1).toBe(key2)
  })

  it('produces different keys for different models', () => {
    const params1 = new URLSearchParams({ models: 'gfs_global', hourly: 'temperature_2m' })
    const params2 = new URLSearchParams({ models: 'icon_global', hourly: 'temperature_2m' })
    expect(buildForecastCacheKey(params1)).not.toBe(buildForecastCacheKey(params2))
  })
})

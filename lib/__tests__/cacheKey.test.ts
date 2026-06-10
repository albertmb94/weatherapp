import { describe, it, expect } from 'vitest'
import { buildForecastCacheKey, buildMarineCacheKey } from '../cacheKey'

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

  it('M6: includes timezone param (cache poisoning fix)', () => {
    // M6: timezone used to be dropped from the key. That caused cache
    // poisoning because the same cell could be filled with data from
    // different timezones (which produce different hourly.time / utc_offset).
    const params1 = new URLSearchParams({
      hourly: 'temperature_2m',
      timezone: 'auto',
    })
    const params2 = new URLSearchParams({
      hourly: 'temperature_2m',
    })
    expect(buildForecastCacheKey(params1)).not.toBe(buildForecastCacheKey(params2))
  })

  it('M6: different timezones produce different keys', () => {
    const p1 = new URLSearchParams({ hourly: 'temperature_2m', timezone: 'auto' })
    const p2 = new URLSearchParams({ hourly: 'temperature_2m', timezone: 'UTC' })
    expect(buildForecastCacheKey(p1)).not.toBe(buildForecastCacheKey(p2))
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

describe('buildMarineCacheKey', () => {
  it('rounds lat/lon to 2 decimals', () => {
    const params = new URLSearchParams({
      latitude: '41.3851',
      longitude: '2.1734',
      hourly: 'wave_height,wave_period',
      forecast_days: '7',
    })
    const key = buildMarineCacheKey(params)
    expect(key).toContain('latitude=41.39')
    expect(key).toContain('longitude=2.17')
  })

  it('drops the models param (marine API does not accept it)', () => {
    const params1 = new URLSearchParams({
      latitude: '41.39',
      longitude: '2.17',
      hourly: 'wave_height',
      models: 'gfs_global',
    })
    const params2 = new URLSearchParams({
      latitude: '41.39',
      longitude: '2.17',
      hourly: 'wave_height',
    })
    expect(buildMarineCacheKey(params1)).toBe(buildMarineCacheKey(params2))
  })

  it('M6: includes timezone param (cache poisoning fix)', () => {
    const p1 = new URLSearchParams({ hourly: 'wave_height', timezone: 'auto' })
    const p2 = new URLSearchParams({ hourly: 'wave_height' })
    expect(buildMarineCacheKey(p1)).not.toBe(buildMarineCacheKey(p2))
  })

  it('produces different keys for different wave metrics', () => {
    const params1 = new URLSearchParams({ hourly: 'wave_height' })
    const params2 = new URLSearchParams({ hourly: 'wave_period' })
    expect(buildMarineCacheKey(params1)).not.toBe(buildMarineCacheKey(params2))
  })
})

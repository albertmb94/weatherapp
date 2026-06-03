import { describe, it, expect } from 'vitest'
import { pickWeatherIcon } from '../weatherIcon'

describe('pickWeatherIcon', () => {
  it('returns sunny for low clouds and no precip', () => {
    expect(pickWeatherIcon({ cloudCoverPct: 10, precipitationMmDay: 0, windGustsKmh: 10, minTempC: 20 })).toBe('sunny')
  })

  it('returns partly for medium clouds', () => {
    expect(pickWeatherIcon({ cloudCoverPct: 50, precipitationMmDay: 0, windGustsKmh: 10, minTempC: 20 })).toBe('partly')
  })

  it('returns cloudy for high clouds', () => {
    expect(pickWeatherIcon({ cloudCoverPct: 80, precipitationMmDay: 0, windGustsKmh: 10, minTempC: 20 })).toBe('cloudy')
  })

  it('returns rainy for precipitation', () => {
    expect(pickWeatherIcon({ cloudCoverPct: 80, precipitationMmDay: 5, windGustsKmh: 10, minTempC: 15 })).toBe('rainy')
  })

  it('returns stormy for heavy precipitation', () => {
    expect(pickWeatherIcon({ cloudCoverPct: 90, precipitationMmDay: 10, windGustsKmh: 10, minTempC: 15 })).toBe('stormy')
  })

  it('returns stormy for high gusts', () => {
    expect(pickWeatherIcon({ cloudCoverPct: 50, precipitationMmDay: 0, windGustsKmh: 90, minTempC: 15 })).toBe('stormy')
  })

  it('returns snowy for precip with low temp', () => {
    expect(pickWeatherIcon({ cloudCoverPct: 80, precipitationMmDay: 5, windGustsKmh: 10, minTempC: 0 })).toBe('snowy')
  })

  it('returns rainy for precip with temp above freezing', () => {
    expect(pickWeatherIcon({ cloudCoverPct: 80, precipitationMmDay: 2, windGustsKmh: 10, minTempC: 5 })).toBe('rainy')
  })

  it('handles null values gracefully', () => {
    expect(pickWeatherIcon({ cloudCoverPct: null, precipitationMmDay: null, windGustsKmh: null, minTempC: null })).toBe('sunny')
  })

  it('returns sunny when all values are zero', () => {
    expect(pickWeatherIcon({ cloudCoverPct: 0, precipitationMmDay: 0, windGustsKmh: 0, minTempC: 99 })).toBe('sunny')
  })
})

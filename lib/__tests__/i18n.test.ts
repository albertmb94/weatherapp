import { describe, it, expect } from 'vitest'
import { STRINGS, DAY_NAMES, LOCALE_STORAGE_KEY } from '../i18n'
import type { Locale } from '../i18n'

describe('i18n', () => {
  describe('STRINGS', () => {
    it('has both locales', () => {
      expect(STRINGS.es).toBeDefined()
      expect(STRINGS.en).toBeDefined()
    })

    it('has matching keys for both locales', () => {
      const esKeys = Object.keys(STRINGS.es).sort()
      const enKeys = Object.keys(STRINGS.en).sort()
      expect(esKeys).toEqual(enKeys)
    })

    it('has non-empty strings for all keys', () => {
      for (const locale of ['es', 'en'] as Locale[]) {
        for (const [key, value] of Object.entries(STRINGS[locale])) {
          expect(value).toBeTruthy()
          expect(typeof value).toBe('string')
        }
      }
    })

    it('has cityCoords with interpolation placeholders', () => {
      expect(STRINGS.es.cityCoords).toContain('{city}')
      expect(STRINGS.es.cityCoords).toContain('{lat}')
      expect(STRINGS.es.cityCoords).toContain('{lon}')
      expect(STRINGS.en.cityCoords).toContain('{city}')
      expect(STRINGS.en.cityCoords).toContain('{lat}')
      expect(STRINGS.en.cityCoords).toContain('{lon}')
    })
  })

  describe('DAY_NAMES', () => {
    it('has both locales', () => {
      expect(DAY_NAMES.es).toBeDefined()
      expect(DAY_NAMES.en).toBeDefined()
    })

    it('has 7 days for each locale', () => {
      expect(DAY_NAMES.es.length).toBe(7)
      expect(DAY_NAMES.en.length).toBe(7)
    })

    it('has non-empty strings', () => {
      for (const name of DAY_NAMES.es) {
        expect(name).toBeTruthy()
      }
      for (const name of DAY_NAMES.en) {
        expect(name).toBeTruthy()
      }
    })
  })

  it('defines LOCALE_STORAGE_KEY', () => {
    expect(LOCALE_STORAGE_KEY).toBe('weather-locale')
  })
})

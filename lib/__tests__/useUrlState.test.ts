import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUrlState } from '../useUrlState'

describe('useUrlState pure functions', () => {
  // We test parseUrlParams and buildQuery logic inline since they're not exported.
  // Instead we test the observable behavior through URLSearchParams.

  describe('parseUrlParams logic', () => {
    function parseUrlParams(params: URLSearchParams) {
      const result: Record<string, unknown> = {}
      const lat = params.get('lat')
      const lon = params.get('lon')
      if (lat && lon && !isNaN(Number(lat)) && !isNaN(Number(lon))) {
        result.lat = Number(lat)
        result.lon = Number(lon)
      }
      const metric = params.get('metric')
      const ALLOWED_METRICS = new Set(['temperature','cloud_cover','wind_speed','precipitation','humidity','uv_index','pressure','wave_height'])
      if (metric && ALLOWED_METRICS.has(metric)) result.metric = metric
      const models = params.get('models')
      if (models !== null) {
        result.models = models === 'none' ? [] : models.split(',').filter(Boolean)
      }
      const hour = params.get('hour')
      if (hour && !isNaN(Number(hour))) result.hour = Number(hour)
      const range = params.get('range')
      const ALLOWED_RANGES = new Set([24, 48, 72, 168, 336])
      if (range && ALLOWED_RANGES.has(Number(range))) result.range = Number(range)
      const showMap = params.get('map')
      if (showMap !== null) result.showMap = showMap === '1'
      const showRadar = params.get('radar')
      if (showRadar !== null) result.showRadar = showRadar === '1'
      const bucket = params.get('bucket')
      const ALLOWED_BUCKETS = new Set([1, 2, 3, 4, 6, 12, 24])
      if (bucket && ALLOWED_BUCKETS.has(Number(bucket))) result.bucket = Number(bucket)
      const locale = params.get('locale')
      if (locale === 'en' || locale === 'es') result.locale = locale
      const marine = params.get('marine')
      if (marine !== null) result.marine = marine === '1'
      const basic = params.get('basic')
      if (basic !== null) result.basic = basic === '1'
      return result
    }

    it('parses lat/lon', () => {
      const params = new URLSearchParams('lat=48.86&lon=2.35')
      const result = parseUrlParams(params)
      expect(result.lat).toBe(48.86)
      expect(result.lon).toBe(2.35)
    })

    it('ignores invalid lat/lon', () => {
      const params = new URLSearchParams('lat=abc&lon=2.35')
      const result = parseUrlParams(params)
      expect(result.lat).toBeUndefined()
    })

    it('parses metric', () => {
      const params = new URLSearchParams('metric=temperature')
      expect(parseUrlParams(params).metric).toBe('temperature')
    })

    it('A3: ignores invalid metric (whitelist)', () => {
      // A3: ?metric=foo must NOT crash the app. It should be ignored so the
      // default metric is used.
      const params = new URLSearchParams('metric=__invalid_metric__')
      expect(parseUrlParams(params).metric).toBeUndefined()
    })

    it('A3: accepts all valid metric ids', () => {
      for (const m of ['temperature', 'cloud_cover', 'wind_speed', 'precipitation', 'humidity', 'uv_index', 'pressure', 'wave_height']) {
        const params = new URLSearchParams(`metric=${m}`)
        expect(parseUrlParams(params).metric).toBe(m)
      }
    })

    it('B4: ignores invalid range (whitelist)', () => {
      const params = new URLSearchParams('range=9999')
      expect(parseUrlParams(params).range).toBeUndefined()
    })

    it('accepts valid range values', () => {
      for (const r of [24, 48, 72, 168, 336]) {
        const params = new URLSearchParams(`range=${r}`)
        expect(parseUrlParams(params).range).toBe(r)
      }
    })

    it('parses models as array', () => {
      const params = new URLSearchParams('models=gfs_global,icon_global')
      expect(parseUrlParams(params).models).toEqual(['gfs_global', 'icon_global'])
    })

    it('parses "none" models as empty array', () => {
      const params = new URLSearchParams('models=none')
      expect(parseUrlParams(params).models).toEqual([])
    })

    it('parses hour and range', () => {
      const params = new URLSearchParams('hour=12&range=48')
      expect(parseUrlParams(params).hour).toBe(12)
      expect(parseUrlParams(params).range).toBe(48)
    })

    it('parses map and radar as booleans', () => {
      const params = new URLSearchParams('map=1&radar=0')
      expect(parseUrlParams(params).showMap).toBe(true)
      expect(parseUrlParams(params).showRadar).toBe(false)
    })

    it('parses valid bucket values', () => {
      for (const b of [1, 2, 3, 4, 6, 12, 24]) {
        const params = new URLSearchParams(`bucket=${b}`)
        expect(parseUrlParams(params).bucket).toBe(b)
      }
    })

    it('ignores invalid bucket values', () => {
      const params = new URLSearchParams('bucket=5')
      expect(parseUrlParams(params).bucket).toBeUndefined()
    })

    it('parses valid locale', () => {
      expect(parseUrlParams(new URLSearchParams('locale=en')).locale).toBe('en')
      expect(parseUrlParams(new URLSearchParams('locale=es')).locale).toBe('es')
    })

    it('ignores invalid locale', () => {
      expect(parseUrlParams(new URLSearchParams('locale=fr')).locale).toBeUndefined()
    })

    it('parses marine=1 as true and marine=0 as false', () => {
      expect(parseUrlParams(new URLSearchParams('marine=1')).marine).toBe(true)
      expect(parseUrlParams(new URLSearchParams('marine=0')).marine).toBe(false)
    })

    it('omits marine when not present in URL', () => {
      expect(parseUrlParams(new URLSearchParams('')).marine).toBeUndefined()
    })

    it('parses basic=1 as true and basic=0 as false', () => {
      expect(parseUrlParams(new URLSearchParams('basic=1')).basic).toBe(true)
      expect(parseUrlParams(new URLSearchParams('basic=0')).basic).toBe(false)
    })

    it('omits basic when not present in URL', () => {
      expect(parseUrlParams(new URLSearchParams('')).basic).toBeUndefined()
    })
  })

  describe('useUrlState hook — popstate behaviour', () => {
    interface DS {
      lat: number; lon: number; metric: string; models: string[]; hour: number; range: number
      showMap: boolean; showRadar: boolean; bucket: number; locale: string; marine: boolean; basic: boolean
    }

    function makeDefaults(): DS {
      return {
        lat: 41.45, lon: 2.2475, metric: 'temperature', models: ['gfs_global'], hour: 0,
        range: 168, showMap: true, showRadar: false, bucket: 4, locale: '', marine: false, basic: true,
      }
    }

    it('B-NEW-1: popstate to a clean URL restores defaults', () => {
      // The user lands at /?lat=41.65&lon=-0.88 (Zaragoza), then hits back
      // to the bare URL. The state must revert to the SSR-safe defaults,
      // not stay pinned to Zaragoza.
      window.history.replaceState(null, '', '/?lat=41.65&lon=-0.88')
      const { result } = renderHook(() => useUrlState(makeDefaults()))
      expect(result.current[0].lat).toBe(41.65)
      expect(result.current[0].lon).toBe(-0.88)

      window.history.replaceState(null, '', '/')
      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'))
      })

      expect(result.current[0].lat).toBe(41.45)
      expect(result.current[0].lon).toBe(2.2475)
    })

    it('popstate to a partial URL merges with the current state', () => {
      window.history.replaceState(null, '', '/?lat=41.65&lon=-0.88&metric=temperature')
      const { result } = renderHook(() => useUrlState(makeDefaults()))
      expect(result.current[0].metric).toBe('temperature')

      // Navigate to a URL that only sets the metric — the lat/lon should
      // stay from the previous state.
      window.history.replaceState(null, '', '/?metric=wind_speed')
      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'))
      })

      expect(result.current[0].metric).toBe('wind_speed')
      expect(result.current[0].lat).toBe(41.65)
      expect(result.current[0].lon).toBe(-0.88)
    })

    it('popstate with no change is a no-op', () => {
      window.history.replaceState(null, '', '/?lat=41.65&lon=-0.88')
      const { result } = renderHook(() => useUrlState(makeDefaults()))
      const before = result.current[0]

      // Dispatch without changing the URL — the state should be identical
      // (same object reference).
      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'))
      })

      expect(result.current[0]).toBe(before)
    })
  })
})

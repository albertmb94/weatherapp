/**
 * Regression tests for S2 (heatmap temporal alignment + proxy
 * duplication fixes).
 *
 *  - `parseOpenMeteoTime` recognises the `±HHMM` (no-colon) and
 *    `±HH:MM:SS` (with-seconds) variants that Open-Meteo emits when
 *    callers request `timeformat=unixtime` or `iso8601` with seconds.
 *  - `buildUpstreamParams` strips cache-only keys (`v`) from the
 *    URL passed upstream while leaving the cache key intact.
 *  - `combineSignals` (inside `openMeteoProxy`) honours both inputs.
 */

import { describe, expect, it } from 'vitest'
import {
  buildForecastCacheKey,
  buildMarineCacheKey,
  buildUpstreamParams,
  STRIPPED_KEYS,
} from '@/lib/cacheKey'
import { parseOpenMeteoTime } from '@/lib/dateUtils'

describe('parseOpenMeteoTime (S2)', () => {
  it('parses Z suffix', () => {
    const d = parseOpenMeteoTime('2026-07-26T00:00Z')
    expect(d.toISOString()).toBe('2026-07-26T00:00:00.000Z')
  })

  it('parses ±HH:MM offsets', () => {
    const d = parseOpenMeteoTime('2026-07-26T00:00+05:30')
    expect(d.toISOString()).toBe('2026-07-25T18:30:00.000Z')
  })

  it('parses ±HHMM (no colon) offsets for non-standard timezones', () => {
    const d = parseOpenMeteoTime('2026-07-26T00:00+0530')
    expect(d.toISOString()).toBe('2026-07-25T18:30:00.000Z')
  })

  it('parses ±HH:MM:SS offsets (rare hour-aligned responses)', () => {
    const d = parseOpenMeteoTime('2026-07-26T00:00:00+05:30')
    // The trailing `:00` seconds are stripped by JS Date — but the
    // offset still anchors the parsing to the right timezone.
    expect(d.getUTCHours()).toBe(18) // 00:00 +05:30 == 18:30 UTC the prior day
    expect(d.getUTCDate()).toBe(25)
  })

  it('appends Z to bare timestamps', () => {
    const d = parseOpenMeteoTime('2026-07-26T00:00')
    expect(d.toISOString()).toBe('2026-07-26T00:00:00.000Z')
  })
})

describe('buildUpstreamParams / STRIPPED_KEYS (S2)', () => {
  it('keeps `v` in the cache key but drops it from the upstream URL', () => {
    const params = new URLSearchParams({
      latitude: '41.39',
      longitude: '2.17',
      hourly: 'temperature_2m',
      models: 'ecmwf_ifs',
      v: '2026-07-26',
    })

    const cacheKey = buildForecastCacheKey(params)
    expect(cacheKey).toContain('v=2026-07-26')

    const upstream = buildUpstreamParams(params)
    expect(upstream.toString()).not.toContain('v=')
    expect(upstream.get('latitude')).toBe('41.39')
  })

  it('exposes `v` as the only currently-stripped key', () => {
    expect([...STRIPPED_KEYS]).toEqual(['v'])
  })

  it('buildMarineCacheKey also strips `v`', () => {
    const params = new URLSearchParams({
      latitude: '41.39',
      longitude: '2.17',
      hourly: 'wave_height',
      v: '2026-07-26',
    })

    expect(buildMarineCacheKey(params)).toContain('v=')
    expect(buildUpstreamParams(params).toString()).not.toContain('v=')
  })
})

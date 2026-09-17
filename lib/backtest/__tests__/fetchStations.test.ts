import { describe, it, expect } from 'vitest'
import { madridWallClock, xemaReadingsToRows } from '@/lib/backtest/fetchStations'
import type { StationMeta } from '@/lib/meteocat'

describe('madridWallClock', () => {
  it('converts UTC to Europe/Madrid wall clock (summer = +2)', () => {
    // 2026-08-15T00:00Z is 02:00 local in CEST.
    expect(madridWallClock('2026-08-15T00:00Z')).toBe('2026-08-15T02:00')
    expect(madridWallClock('2026-08-15T12:00Z')).toBe('2026-08-15T14:00')
  })

  it('handles the winter offset (+1)', () => {
    expect(madridWallClock('2026-01-15T00:00Z')).toBe('2026-01-15T01:00')
  })

  it('returns null on an invalid stamp', () => {
    expect(madridWallClock('not-a-date')).toBeNull()
  })
})

describe('xemaReadingsToRows', () => {
  const meta = new Map<string, StationMeta>([
    ['AN', { name: 'Barcelona', lat: 41.39, lon: 2.18 }],
  ])

  it('maps readings to rows and aligns the hour to local time', () => {
    const rows = xemaReadingsToRows(meta, {
      temperature: new Map([['AN', [{ data: '2026-08-15T00:00Z', valor: 21.5 }]]]),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      source: 'xema',
      station_id: 'AN',
      station_name: 'Barcelona',
      lat: 41.39,
      lon: 2.18,
      valid_time: '2026-08-15T02:00',
      metric: 'temperature',
      observed_value: 21.5,
    })
  })

  it('converts wind from m/s to km/h', () => {
    const rows = xemaReadingsToRows(meta, {
      wind_speed: new Map([['AN', [{ data: '2026-08-15T00:00Z', valor: 10 }]]]),
    })
    expect(rows[0].observed_value).toBeCloseTo(36, 6)
  })

  it('skips stations missing from the metadata', () => {
    const rows = xemaReadingsToRows(meta, {
      temperature: new Map([['ZZ', [{ data: '2026-08-15T00:00Z', valor: 20 }]]]),
    })
    expect(rows).toEqual([])
  })
})

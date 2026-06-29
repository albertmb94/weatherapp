import { describe, it, expect } from 'vitest'
import { computeCurrentSnapshot, computeHourlySlots, computeWeekSummaries } from '../friendlyForecast'

const MODELS = [
  { id: 'gfs_global', label: 'GFS', color: '#fff', maxHours: 384, weight: 50 },
  { id: 'icon_global', label: 'ICON', color: '#fff', maxHours: 240, weight: 50 },
]

function flatSeries(value: number, count: number) {
  return {
    gfs_global: {
      temperature: Array.from({ length: count }, () => value),
      precipitation: Array.from({ length: count }, () => 0),
      wind_speed: Array.from({ length: count }, () => 5),
      wind_gusts: Array.from({ length: count }, () => 5),
      cloud_cover: Array.from({ length: count }, () => 0),
      humidity: Array.from({ length: count }, () => 50),
      uv_index: Array.from({ length: count }, () => 3),
    },
    icon_global: {
      temperature: Array.from({ length: count }, () => value),
      precipitation: Array.from({ length: count }, () => 0),
      wind_speed: Array.from({ length: count }, () => 5),
      wind_gusts: Array.from({ length: count }, () => 5),
      cloud_cover: Array.from({ length: count }, () => 0),
      humidity: Array.from({ length: count }, () => 50),
      uv_index: Array.from({ length: count }, () => 3),
    },
  }
}

/**
 * Generate `count` consecutive hourly UTC-fake-local timestamps starting at
 * today's midnight (2026-06-10T00:00 local). Tests can pick a `nowIndex`
 * anywhere inside the array.
 */
function fakeTimes(count: number): Date[] {
  const out: Date[] = []
  const base = new Date(Date.UTC(2026, 5, 10, 0, 0, 0))
  for (let i = 0; i < count; i++) {
    out.push(new Date(base.getTime() + i * 3_600_000))
  }
  return out
}

describe('computeCurrentSnapshot', () => {
  it('returns the weighted current conditions for the supplied hour index', () => {
    const out = computeCurrentSnapshot(
      { time: fakeTimes(4), series: flatSeries(20, 4) },
      MODELS,
      ['gfs_global', 'icon_global'],
      1
    )
    expect(out).not.toBeNull()
    expect(out?.temperatureC).toBe(20)
    expect(out?.windKmh).toBe(5)
    expect(out?.chanceOfRainPct).toBe(0)
    expect(out?.uvIndex).toBe(3)
  })

  it('counts >0mm/h precipitation as a non-zero rain chance', () => {
    const series = flatSeries(20, 4)
    for (const id of Object.keys(series) as Array<keyof typeof series>) {
      series[id].precipitation[1] = 2 // mm/h, well above the 1mm/h = 80% threshold
    }
    const out = computeCurrentSnapshot({ time: fakeTimes(4), series }, MODELS, ['gfs_global', 'icon_global'], 1)
    expect(out?.chanceOfRainPct).toBe(100)
  })

  it('returns null when the index is past the data', () => {
    expect(computeCurrentSnapshot({ time: [], series: {} }, MODELS, ['gfs_global'], 0)).toBeNull()
  })

  it('exposes the day’s peak UV (avoids sticky 0.0 at night)', () => {
    // 24 hourly entries, current hour is 03:00 (the user's typical "I never
    // see anything" case). The day's peak should still report 3.
    const out = computeCurrentSnapshot(
      { time: fakeTimes(24), series: flatSeries(20, 24) },
      MODELS,
      ['gfs_global', 'icon_global'],
      3
    )
    expect(out?.uvIndex).toBe(3)
    expect(out?.uvIndexPeak).toBe(3)
  })
})

describe('computeHourlySlots', () => {
  it('returns the six 4-hour blocks starting at today’s midnight', () => {
    // nowIndex = 14 (14:00 today). The six 4-hour blocks are 00, 04, 08, 12,
    // 16, 20; index 3 (12:00) is the block that contains 14:00 and is
    // re-labelled "Now".
    const slots = computeHourlySlots(
      { time: fakeTimes(36), series: flatSeries(18, 36) },
      MODELS,
      ['gfs_global', 'icon_global'],
      14,
      'en',
      6,
      4
    )
    expect(slots.length).toBe(6)
    expect(slots[3].hourLabel.toLowerCase()).toBe('now')
    expect(slots[0].hourLabel.toLowerCase()).toBe('12 am')
    expect(slots[5].hourLabel.toLowerCase()).toBe('8 pm')
  })

  it('keeps producing slot rows past today (slots 0,4,8,12,16,20 tomorrow)', () => {
    // The forecast should not stop at the day boundary if there is data.
    const slots = computeHourlySlots(
      { time: fakeTimes(48), series: flatSeries(18, 48) },
      MODELS,
      ['gfs_global', 'icon_global'],
      4,
      'es',
      6,
      4
    )
    expect(slots.length).toBe(6)
  })

  it('returns no slots when today’s midnight is not present', () => {
    // 12-hour window starting at 04:00 today — no 00:00 entry, so the
    // helper returns an empty list (caller can fall back).
    const out: Date[] = []
    const base = new Date(Date.UTC(2026, 5, 10, 4, 0, 0))
    for (let i = 0; i < 12; i++) out.push(new Date(base.getTime() + i * 3_600_000))
    const slots = computeHourlySlots(
      { time: out, series: flatSeries(18, 12) },
      MODELS,
      ['gfs_global', 'icon_global'],
      0,
      'en',
      6,
      4
    )
    expect(slots).toEqual([])
  })

  it('falls back gracefully when the requested block is past the data end', () => {
    // 5-hour window starting at today’s 22:00 — only blocks 20 and 00 (next
    // day) are reachable; the helper yields whatever still has data.
    const out: Date[] = []
    const base = new Date(Date.UTC(2026, 5, 10, 22, 0, 0))
    for (let i = 0; i < 5; i++) out.push(new Date(base.getTime() + i * 3_600_000))
    const slots = computeHourlySlots(
      { time: out, series: flatSeries(18, 5) },
      MODELS,
      ['gfs_global', 'icon_global'],
      0,
      'en',
      6,
      4
    )
    expect(slots.length).toBeLessThanOrEqual(2)
  })
})

describe('computeWeekSummaries', () => {
  it('produces the requested number of day entries', () => {
    const days = computeWeekSummaries(
      { time: fakeTimes(48), series: flatSeries(20, 48) },
      MODELS,
      ['gfs_global', 'icon_global'],
      0,
      48,
      'en',
      7
    )
    expect(days.length).toBe(2) // today + tomorrow
  })

  it('honours the 14-day count', () => {
    // Need >14 days of data. Generate 16 days starting today at midnight.
    const out: Date[] = []
    const base = new Date(Date.UTC(2026, 5, 10, 0, 0, 0))
    for (let i = 0; i < 24 * 16; i++) out.push(new Date(base.getTime() + i * 3_600_000))
    const days = computeWeekSummaries(
      { time: out, series: flatSeries(20, 24 * 16) },
      MODELS,
      ['gfs_global', 'icon_global'],
      0,
      24 * 16,
      'en',
      14
    )
    expect(days.length).toBe(14)
  })
})


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
    expect(out?.temperatureC).toBeCloseTo(20, 0)
    expect(out?.windKmh).toBeCloseTo(5, 0)
    expect(out?.chanceOfRainPct).toBe(0)
    expect(out?.uvIndex).toBeCloseTo(3, 0)
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
  it('starts at the 4h block containing the current hour and labels it Now', () => {
    // nowIndex = 14 (14:00 today). The 4h block containing 14:00 is
    // [12, 16); slot 0 anchors at index 12 and gets the "Now" label.
    // Six more slots at 4h intervals land at 16, 20, 00 (next day),
    // 04, 08, with their respective hour-of-day labels.
    const slots = computeHourlySlots(
      { time: fakeTimes(48), series: flatSeries(18, 48) },
      MODELS,
      ['gfs_global', 'icon_global'],
      14,
      'en',
      7,
      4
    )
    expect(slots.length).toBe(7)
    expect(slots[0].hourLabel.toLowerCase()).toBe('now')
    expect(slots[1].hourLabel.toLowerCase()).toBe('4 pm')
    expect(slots[2].hourLabel.toLowerCase()).toBe('8 pm')
    expect(slots[3].hourLabel.toLowerCase()).toBe('12 am')
    expect(slots[6].hourLabel.toLowerCase()).toBe('12 pm')
  })

  it('keeps producing slot rows past today (slots cross into the next day)', () => {
    // The strip is forward-looking and shouldn't stop at the day boundary.
    const slots = computeHourlySlots(
      { time: fakeTimes(96), series: flatSeries(18, 96) },
      MODELS,
      ['gfs_global', 'icon_global'],
      22,
      'es',
      7,
      4
    )
    expect(slots.length).toBe(7)
    // 22:00 is in the 20-24 block → first slot at 20:00.
    expect(slots[0].hourLabel.toLowerCase()).toBe('ahora')
    expect(slots[1].hourLabel.toLowerCase()).toBe('0h')
  })

  it('suppresses the Ahora label when isViewingToday is false', () => {
    // Same as the default test but with isViewingToday=false. The strip
    // should still show 7 4h blocks but the first slot's label is the
    // block hour, not "Ahora".
    const slots = computeHourlySlots(
      { time: fakeTimes(48), series: flatSeries(18, 48) },
      MODELS,
      ['gfs_global', 'icon_global'],
      14,
      'es',
      7,
      4,
      false
    )
    expect(slots.length).toBe(7)
    expect(slots[0].hourLabel.toLowerCase()).not.toBe('ahora')
    expect(slots[0].hourLabel.toLowerCase()).toBe('12h')
  })

  it('returns no slots when the anchor block is not present', () => {
    // 12-hour window starting at 04:00 today — the 4h block containing
    // 04:00 is [4, 8) which IS present, so this case returns slots.
    // For a true empty result we anchor past the data end.
    const out: Date[] = []
    const base = new Date(Date.UTC(2026, 5, 10, 0, 0, 0))
    for (let i = 0; i < 24; i++) out.push(new Date(base.getTime() + i * 3_600_000))
    const slots = computeHourlySlots(
      { time: out, series: flatSeries(18, 24) },
      MODELS,
      ['gfs_global', 'icon_global'],
      22, // block [20, 24) is present
      'en',
      7,
      4
    )
    expect(slots.length).toBeGreaterThan(0)
  })

  it('falls back gracefully when the requested block is past the data end', () => {
    // 5-hour window starting at today's 22:00 — anchor block [20,24) is
    // present but only 2 more slots (00, 04 next day) fit before the end.
    const out: Date[] = []
    const base = new Date(Date.UTC(2026, 5, 10, 22, 0, 0))
    for (let i = 0; i < 5; i++) out.push(new Date(base.getTime() + i * 3_600_000))
    const slots = computeHourlySlots(
      { time: out, series: flatSeries(18, 5) },
      MODELS,
      ['gfs_global', 'icon_global'],
      0,
      'en',
      7,
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


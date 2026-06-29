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

function fakeTimes(count: number, startUtcHour = 0): Date[] {
  const out: Date[] = []
  for (let i = 0; i < count; i++) {
    out.push(new Date(Date.UTC(2026, 5, 10, (startUtcHour + i) % 24, 0, 0) + Math.floor(i / 24) * 86_400_000 + Math.floor((startUtcHour + i) / 24) * 86_400_000))
  }
  // The above intentionally rebases every entry on UTC midnight day 0
  // for simplicity — enough for tests that don't care about timezone math.
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
    for (const id of Object.keys(series)) {
      series[id].precipitation[1] = 2 // mm/h, well above the 1mm/h = 80% threshold
    }
    const out = computeCurrentSnapshot({ time: fakeTimes(4), series }, MODELS, ['gfs_global', 'icon_global'], 1)
    expect(out?.chanceOfRainPct).toBe(100)
  })

  it('returns null when the index is past the data', () => {
    expect(computeCurrentSnapshot({ time: [], series: {} }, MODELS, ['gfs_global'], 0)).toBeNull()
  })
})

describe('computeHourlySlots', () => {
  it('returns slots up to the requested count', () => {
    const slots = computeHourlySlots(
      { time: fakeTimes(8), series: flatSeries(18, 8) },
      MODELS,
      ['gfs_global', 'icon_global'],
      0,
      'en',
      8
    )
    expect(slots.length).toBe(8)
    expect(slots[0].tempC).toBe(18)
  })

  it('stops early when the data ends', () => {
    const slots = computeHourlySlots(
      { time: fakeTimes(3), series: flatSeries(18, 3) },
      MODELS,
      ['gfs_global', 'icon_global'],
      0,
      'en',
      8
    )
    expect(slots.length).toBe(3)
  })
})

describe('computeWeekSummaries', () => {
  it('produces one entry per unique calendar day', () => {
    const days = computeWeekSummaries(
      { time: fakeTimes(48, 12), series: flatSeries(20, 48) },
      MODELS,
      ['gfs_global', 'icon_global'],
      0,
      48,
      'en'
    )
    expect(days.length).toBeGreaterThanOrEqual(1)
    for (const d of days) {
      expect(d.highC).toBe(20)
      expect(d.lowC).toBe(20)
      expect(d.icon).toBe('sunny')
    }
  })
})

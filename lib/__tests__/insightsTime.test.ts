import { describe, it, expect } from 'vitest'
import { computeInsightsStartIndex } from '../insightsTime'
import { REFRESH_WINDOW_MS, REFRESH_WINDOW_HOURS } from '../refreshWindow'

/**
 * Build a UTC-fake-local hour series starting at `startUtcHour` of
 * the supplied date so the test doesn't depend on the wall clock.
 */
function hoursStartingAt(year: number, month: number, day: number, startUtcHour: number, count: number): Date[] {
  const out: Date[] = []
  for (let i = 0; i < count; i++) {
    out.push(new Date(Date.UTC(year, month, day, startUtcHour + i, 0, 0)))
  }
  return out
}

describe('refreshWindow', () => {
  it('defaults to 2 hours', () => {
    expect(REFRESH_WINDOW_MS).toBe(2 * 60 * 60 * 1000)
    expect(REFRESH_WINDOW_HOURS).toBe(2)
  })
})

describe('computeInsightsStartIndex', () => {
  it('returns 0 when the first hour is the current hour (inclusive)', () => {
    const times = hoursStartingAt(2026, 6, 10, 17, 24) // 2026-07-10 17:00, 18:00, ...
    // 17:00 is the current hour → startIndex is 0.
    const now = Date.UTC(2026, 6, 10, 17, 0, 0)
    expect(computeInsightsStartIndex(times, 0, now)).toBe(0)
  })

  it('skips past hours when the wall clock is past the first entry', () => {
    // Mirror the user's example: it's 17:52, the series starts at 14:00.
    // The Insights table must start at 17:00 (i=3), never 14:00.
    const times = hoursStartingAt(2026, 6, 10, 14, 24) // 14:00, 15:00, 16:00, 17:00, ...
    const now = Date.UTC(2026, 6, 10, 17, 52, 0)
    expect(computeInsightsStartIndex(times, 0, now)).toBe(3)
  })

  it('honours the location UTC offset (location 1h ahead of the wall clock)', () => {
    // Wall clock 17:00, location UTC offset +3600s. The location's
    // current hour is 18:00, so the table starts at 18:00.
    const times = hoursStartingAt(2026, 6, 10, 17, 6) // 17:00..22:00
    const wallClockNow = Date.UTC(2026, 6, 10, 17, 30, 0)
    const utcOffsetSeconds = 3600
    expect(computeInsightsStartIndex(times, utcOffsetSeconds, wallClockNow)).toBe(1)
  })

  it('returns the array length when every hour is in the past', () => {
    const times = hoursStartingAt(2026, 6, 10, 14, 4)
    const now = Date.UTC(2026, 6, 11, 0, 0, 0)
    expect(computeInsightsStartIndex(times, 0, now)).toBe(4)
  })

  it('returns 0 for an empty series', () => {
    expect(computeInsightsStartIndex([], 0, Date.now())).toBe(0)
  })

  it('is stable across hours (17:30 and 17:59 both anchor to 17:00)', () => {
    const times = hoursStartingAt(2026, 6, 10, 14, 6)
    const at1730 = Date.UTC(2026, 6, 10, 17, 30, 0)
    const at1759 = Date.UTC(2026, 6, 10, 17, 59, 59)
    expect(computeInsightsStartIndex(times, 0, at1730)).toBe(3)
    expect(computeInsightsStartIndex(times, 0, at1759)).toBe(3)
  })
})

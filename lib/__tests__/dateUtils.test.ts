import { describe, it, expect, vi } from 'vitest'
import { getLocationNow, formatLocationTime } from '../dateUtils'

describe('getLocationNow (A1)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns a UTC-fake-local Date whose getUTCHours equals the location hour', () => {
    // 2026-06-10 18:00:00 UTC
    const fakeNow = new Date(Date.UTC(2026, 5, 10, 18, 0, 0))
    vi.setSystemTime(fakeNow)
    // Madrid summer: UTC+2 (offset = 7200)
    const now = getLocationNow(7200)
    expect(now.getUTCHours()).toBe(20) // 18 UTC + 2h offset
    expect(now.getUTCMinutes()).toBe(0)
  })

  it('is independent of the browser timezone (A1 fix)', () => {
    // Before A1 fix, getLocationNow shifted "now" by the browser's TZ offset
    // as well, which produced wrong results when the user was in a TZ
    // different from the queried location.
    const fakeNow = new Date(Date.UTC(2026, 5, 10, 18, 0, 0))
    vi.setSystemTime(fakeNow)

    // Simulate a user in a different TZ by stubbing getTimezoneOffset.
    // New York summer: UTC-4 → getTimezoneOffset() === 240.
    const nySpy = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(240)
    const madridNow = getLocationNow(7200)
    nySpy.mockRestore()

    // The result must depend only on utcOffsetSeconds, not on the
    // browser's TZ offset. So 18:00 UTC + 2h = 20:00 (in fake-UTC).
    expect(madridNow.getUTCHours()).toBe(20)
  })

  it('returns now at 00:00 location time for offset 0 (UTC)', () => {
    const fakeNow = new Date(Date.UTC(2026, 5, 10, 12, 0, 0))
    vi.setSystemTime(fakeNow)
    const now = getLocationNow(0)
    expect(now.getUTCHours()).toBe(12)
  })

  it('returns now for a negative offset (Americas)', () => {
    const fakeNow = new Date(Date.UTC(2026, 5, 10, 12, 0, 0))
    vi.setSystemTime(fakeNow)
    // New York summer: UTC-4 (offset = -14400)
    const now = getLocationNow(-14400)
    expect(now.getUTCHours()).toBe(8) // 12 UTC - 4h
  })
})

describe('formatLocationTime (UTC-fake-local)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('formats a fake-UTC Date as the location local time', () => {
    const fakeNow = new Date(Date.UTC(2026, 5, 10, 18, 0, 0))
    vi.setSystemTime(fakeNow)
    const now = getLocationNow(7200) // 20:00 fake-UTC
    expect(formatLocationTime(now, 'en', { hour: '2-digit', minute: '2-digit', hour12: false })).toBe('20:00')
  })
})

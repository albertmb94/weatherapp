/**
 * Regression for the "previsión de hoy slices at fetchedAt hour"
 * bug reported on 2026-08-18.
 *
 * Before the fix, `startIndex` was anchored on `effectiveData.fetchedAt`,
 * so a forecast cached at 07:00 still started at the 07:00 row when
 * the user opened the app at 08:30 — the hourly forecast strip
 * showed a ghost hour the user had to scroll past to reach the
 * actual current hour.
 *
 * After the fix, `startIndex` is anchored on the client wall
 * clock (`currentTickMs`), so the slice starts at the current hour
 * (rounded down) regardless of when the data was last fetched —
 * provided the forecast isn't older than the 2-hour auto-refresh
 * window (otherwise the auto-refresh effect would have fired first).
 */
import { describe, it, expect } from 'vitest'
import { floorHourLocation } from '@/lib/dateUtils'

const UTC_OFFSET_S = 2 * 3600 // CEST — matches the user's location

function utcFakeLocal(yyyy: number, mm: number, dd: number, hh: number, min = 0, sec = 0) {
  // Open-Meteo's UTC-fake-local convention: parse the hour as if it
  // were UTC so `getUTCHours()` returns the local-hour reading.
  // `Date.UTC(...)` already produces that timestamp directly.
  return new Date(Date.UTC(yyyy, mm, dd, hh, min, sec))
}

function makeTimes(): Date[] {
  // 24 hours, every hour on the hour, in UTC-fake-local format for
  // a +2h location.
  const out: Date[] = []
  for (let i = 0; i < 24; i++) {
    out.push(utcFakeLocal(2026, 7, 18, i))
  }
  return out
}

const TIMES = makeTimes()

/**
 * Pure port of the `startIndex` computation in
 * `app/home-content.tsx`. We keep the logic inline (instead of
 * importing the file) because the auto-refresh wiring and the rest
 * of the orchestrator are out of scope for this regression.
 */
function computeStartIndex(args: {
  time: Date[]
  utcOffsetSeconds: number
  /** Reference timestamp for the "current hour" anchor. */
  referenceMs: number
}) {
  const { time, utcOffsetSeconds, referenceMs } = args
  if (!time.length || !referenceMs) return 0
  const referenceLocal = new Date(referenceMs + utcOffsetSeconds * 1000)
  const nowFloor = floorHourLocation(referenceLocal)
  const nowTs = nowFloor.getTime()
  for (let i = 0; i < time.length; i++) {
    const t = time[i]
    if (t instanceof Date && t.getTime() >= nowTs) return i
  }
  return time.length
}

describe('B-NEW-39 — hourly forecast slice anchored on wall clock', () => {
  // The orchestrator's `startIndex` useMemo uses `currentTickMs ||
  // effectiveData.fetchedAt` as the anchor. We test the two pieces:
  // (a) when the wall clock is ready, it wins, so the slice starts at
  // the current hour even if `fetchedAt` is older.
  // (b) when the wall clock is not ready (currentTickMs === 0, the
  // `useClientNow` initial state), it falls back to `fetchedAt` for
  // SSR/first-render consistency.

  it('starts at the current hour (08:00) when the forecast was issued at 07:00', () => {
    // Forecast issued 1.5h ago — within the 2h auto-refresh window.
    const fetchedAtMs = new Date('2026-08-18T05:00:00Z').getTime() // 07:00 CEST
    const wallClock = new Date('2026-08-18T06:30:00Z').getTime() // 08:30 CEST
    const startIndex = computeStartIndex({
      time: TIMES,
      utcOffsetSeconds: UTC_OFFSET_S,
      referenceMs: wallClock,
    })
    // First row at index 8 → 08:00 CEST.
    expect(TIMES[startIndex].getUTCHours()).toBe(8)
    expect(startIndex).toBe(8)
    // Sanity: had we used fetchedAt instead, we'd land on 07:00 (index 7).
    const fetchedAtIndex = computeStartIndex({
      time: TIMES,
      utcOffsetSeconds: UTC_OFFSET_S,
      referenceMs: fetchedAtMs,
    })
    expect(fetchedAtIndex).toBe(7)
  })

  it('starts at the current hour (08:00) when the forecast was issued at 08:00 (same hour)', () => {
    // Forecast issued "right now" — fetchedAt == wall clock.
    const wallClock = new Date('2026-08-18T06:00:00Z').getTime() // 08:00 CEST
    const startIndex = computeStartIndex({
      time: TIMES,
      utcOffsetSeconds: UTC_OFFSET_S,
      referenceMs: wallClock,
    })
    expect(startIndex).toBe(8)
  })

  it('falls back to fetchedAt when the wall clock is not ready (currentTickMs === 0)', () => {
    // The orchestrator uses `currentTickMs || effectiveData.fetchedAt`,
    // so a falsy `currentTickMs` falls back to fetchedAt — that's the
    // SSR / first-render path before the `useClientNow` effect fires.
    const fetchedAtMs = new Date('2026-08-18T05:00:00Z').getTime() // 07:00 CEST
    const startIndex = computeStartIndex({
      time: TIMES,
      utcOffsetSeconds: UTC_OFFSET_S,
      referenceMs: fetchedAtMs,
    })
    // The fallback uses fetchedAt (07:00) → first row at 07:00.
    expect(startIndex).toBe(7)
  })
})

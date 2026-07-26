/**
 * Regression tests for S6 — extracted `lib/insightRows` helpers.
 *
 * The previous bucket builder lived inside `InsightsTable.tsx`'s
 * 320-line `useMemo` and had three different but similar algorithms
 * for `bucket=1`, `bucket=24` and bucket-aligned hours. The S6
 * refactor centralised them in `lib/insightRows.ts`; these tests pin
 * the public behaviour so the move can't regress.
 */

import { describe, expect, it } from 'vitest'
import {
  absoluteLead,
  aggregateOverRange,
  alignToHourBoundary,
  boundsForBucket,
  hourEpochMs,
} from '../insightRows'

const HOUR = 60 * 60 * 1000

function times(days: number, hoursPerDay = 24): Date[] {
  const out: Date[] = []
  for (let h = 0; h < days * hoursPerDay; h++) {
    out.push(new Date(Date.UTC(2026, 6, 1, h, 0, 0)))
  }
  return out
}

describe('boundsForBucket (hour-aligned)', () => {
  it('handles bucket=1 by producing 1-hour ranges', () => {
    const ts = times(2)
    const ranges = boundsForBucket(ts, undefined, 0, 1, 24)
    expect(ranges).toHaveLength(24)
    expect(ranges[0]).toEqual({ startIdx: 0, endIdx: 0 })
    expect(ranges[23]).toEqual({ startIdx: 23, endIdx: 23 })
  })

  it('aligns bucket=6 ranges to the wall-clock hour', () => {
    const ts = times(2)
    const ranges = boundsForBucket(ts, undefined, 0, 6, 24)
    expect(ranges).toHaveLength(4)
    expect(ranges[0]).toEqual({ startIdx: 0, endIdx: 5 })
    expect(ranges[1]).toEqual({ startIdx: 6, endIdx: 11 })
  })

  it('respects the `limit` cap', () => {
    const ts = times(2)
    const ranges = boundsForBucket(ts, undefined, 0, 1, 5)
    expect(ranges).toHaveLength(5)
  })
})

describe('boundsForBucket (day-aligned, bucket=24)', () => {
  it('walks each day from 00:00 to the next 00:00', () => {
    const ts = times(3)
    const ranges = boundsForBucket(ts, ts, 0, 24, 24 * 3, 7)
    expect(ranges).toHaveLength(3)
    expect(ranges[0]).toEqual({ startIdx: 0, endIdx: 23 })
    expect(ranges[1]).toEqual({ startIdx: 24, endIdx: 47 })
    expect(ranges[2]).toEqual({ startIdx: 48, endIdx: 71 })
  })

  it('scans backwards to 00:00 when startIndex is mid-day', () => {
    const ts = times(3)
    // User opens the app at hour 14 of day 0 with bucket=24.
    const ranges = boundsForBucket(ts, ts, 14, 24, 24 * 3, 7)
    expect(ranges.length).toBeGreaterThanOrEqual(2)
    expect(ranges[0]?.startIdx).toBe(0)
  })
})

describe('aggregateOverRange', () => {
  it('skips null cells and returns null when nothing contributed', () => {
    expect(aggregateOverRange([null, null], 0, 1)).toBeNull()
    expect(aggregateOverRange([1, 2, 3], 0, 2)).toBe(2)
    expect(aggregateOverRange([1, null, 5], 0, 2)).toBe(3)
  })
})

describe('absoluteLead', () => {
  it('centres the bucket, not the start of it', () => {
    expect(absoluteLead(0, 86, 1)).toBe(86)
    expect(absoluteLead(0, 86, 12)).toBe(97)
  })
})

describe('alignToHourBoundary', () => {
  it('aligns to the start of an hour bucket', () => {
    const ts = times(1)
    expect(alignToHourBoundary(ts, 7, 4)).toBe(7 - (7 % 4))
  })
})

describe('hourEpochMs', () => {
  it('rounds to the hour', () => {
    expect(hourEpochMs(new Date(Date.UTC(2026, 6, 1, 14, 30, 0)))).toBe(
      Date.UTC(2026, 6, 1, 14, 0, 0),
    )
    // Two timestamps in the same hour collapse to the same ms.
    const a = hourEpochMs(new Date(Date.UTC(2026, 6, 1, 14, 0, 0)))
    const b = hourEpochMs(new Date(Date.UTC(2026, 6, 1, 14, 23, 0)))
    expect(a).toBe(b)
    // Distance between two adjacent hours is exactly 1 hour.
    const next = new Date(a + HOUR)
    expect(next.getUTCHours()).toBe(15)
  })
})

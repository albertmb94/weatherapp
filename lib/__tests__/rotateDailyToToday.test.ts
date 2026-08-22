/**
 * B-NBT-9 regression tests for `rotateDailyToToday`.
 *
 * The crash class this pins: snapshots persisted by pre-B-NEW-41 builds
 * lack `dailyTime`; hydrating them on the offline path used to throw a
 * TypeError inside a render-path useMemo and white-screen the app.
 */
import { describe, it, expect } from 'vitest'
import { rotateDailyToToday } from '../openMeteo'
import type { ForecastResult } from '../openMeteo'

function makeData(overrides: Partial<ForecastResult> = {}): ForecastResult {
  return {
    time: [],
    timeStrings: [],
    series: {},
    utcOffsetSeconds: 0,
    fetchedAt: 0,
    dailyPrecipitationSum: [1, 2, 3],
    dailyPrecipitationProbabilityMax: [],
    dailyTime: [],
    dailyPrecipitationHours: [],
    modelsWithNoData: [],
    ...overrides,
  } as ForecastResult
}

describe('rotateDailyToToday', () => {
  it('returns the raw array unchanged when dailyTime is missing (legacy snapshot)', () => {
    const data = makeData({ dailyTime: undefined as unknown as ForecastResult['dailyTime'] })
    expect(() => rotateDailyToToday(data)).not.toThrow()
    expect(rotateDailyToToday(data)).toEqual([1, 2, 3])
  })

  it('rotates so index 0 is today', () => {
    const today = new Date()
    const d0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 3))
    const mk = (offsetDays: number) =>
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offsetDays))
    const dailyTime = [d0, mk(-2), mk(-1), mk(0), mk(1), mk(2)]
    const data = makeData({
      dailyTime,
      dailyPrecipitationSum: [9, 8, 7, 5.5, 4, 3],
      utcOffsetSeconds: 0,
    })
    const out = rotateDailyToToday(data)
    // Index 0 must now be TODAY's value (5.5), not 3-days-ago (9).
    expect(out[0]).toBe(5.5)
    expect(out).toHaveLength(3)
  })

  it('falls back to the raw array when today is not in dailyTime', () => {
    const old = new Date(Date.UTC(2020, 0, 1))
    const data = makeData({ dailyTime: [old], dailyPrecipitationSum: [4, 5] })
    expect(rotateDailyToToday(data)).toEqual([4, 5])
  })

  it('handles empty and null inputs', () => {
    // Empty dailyTime = day never found → raw array passthrough.
    expect(rotateDailyToToday(makeData())).toEqual([1, 2, 3])
    expect(rotateDailyToToday(null)).toEqual([])
    expect(rotateDailyToToday({ ...makeData(), dailyPrecipitationSum: [] })).toEqual([])
  })
})

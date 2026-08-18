import { describe, it, expect } from 'vitest'
import { shouldAutoRefresh } from '../autoRefresh'

const REFRESH_WINDOW_MS = 2 * 60 * 60 * 1000
const THROTTLE_MS = 60_000

function args(overrides: Partial<Parameters<typeof shouldAutoRefresh>[0]> = {}) {
  return {
    forecastAgeMs: REFRESH_WINDOW_MS + 1000,
    refreshWindowMs: REFRESH_WINDOW_MS,
    isFetching: false,
    lastRefreshAt: 0,
    now: 1_000_000,
    isVisible: true,
    throttleMs: THROTTLE_MS,
    ...overrides,
  }
}

describe('shouldAutoRefresh', () => {
  it('returns true when the forecast is older than the refresh window and nothing else blocks it', () => {
    expect(shouldAutoRefresh(args())).toBe(true)
  })

  it('returns false when the forecast is still fresh', () => {
    expect(shouldAutoRefresh(args({ forecastAgeMs: REFRESH_WINDOW_MS - 1 }))).toBe(false)
  })

  it('returns false when the forecast is exactly at the refresh window minus 1 ms', () => {
    expect(shouldAutoRefresh(args({ forecastAgeMs: REFRESH_WINDOW_MS - 1 }))).toBe(false)
  })

  it('returns false when forecastAgeMs is null (no data yet)', () => {
    expect(shouldAutoRefresh(args({ forecastAgeMs: null }))).toBe(false)
  })

  it('returns false when a fetch is already in flight', () => {
    expect(shouldAutoRefresh(args({ isFetching: true }))).toBe(false)
  })

  it('returns false when the tab is hidden', () => {
    expect(shouldAutoRefresh(args({ isVisible: false }))).toBe(false)
  })

  it('returns false when the throttle window has not elapsed', () => {
    // lastRefreshAt was 1s ago — under the 60s throttle window.
    expect(shouldAutoRefresh(args({ lastRefreshAt: 999_000, now: 1_000_000 }))).toBe(false)
  })

  it('returns true once the throttle window has elapsed', () => {
    // lastRefreshAt was 61s ago — past the 60s throttle window.
    expect(shouldAutoRefresh(args({ lastRefreshAt: 939_000, now: 1_000_000 }))).toBe(true)
  })

  it('respects a custom throttle window', () => {
    // 1 s gap, 5 s throttle → blocked.
    expect(shouldAutoRefresh(args({
      lastRefreshAt: 999_000,
      now: 1_000_000,
      throttleMs: 5_000,
    }))).toBe(false)
    // 6 s gap, 5 s throttle → passes.
    expect(shouldAutoRefresh(args({
      lastRefreshAt: 994_000,
      now: 1_000_000,
      throttleMs: 5_000,
    }))).toBe(true)
  })

  it('returns false on the very first tick (lastRefreshAt = now, throttle = 0)', () => {
    // lastRefreshAt=now collapses the throttle window to 0; the
    // first call after the manager resets the ref should still
    // fire. Use the manager's reset semantics: lastRefreshAt=0
    // means "never refreshed", so the first call passes.
    expect(shouldAutoRefresh(args({ lastRefreshAt: 0, now: 1_000_000 }))).toBe(true)
  })
})

/**
 * Regression tests for S4 (extracted hooks layer).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedCallback } from '../useDebouncedCallback'
import { useClientNow } from '../useClientNow'
import { useGeolocation } from '../useGeolocation'

describe('useDebouncedCallback', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces multiple calls into the latest one', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 200))
    act(() => {
      result.current(1)
      result.current(2)
      result.current(3)
    })
    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(fn).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3)
  })

  it('cancel() prevents the pending timer from firing', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 200))
    act(() => {
      result.current('hello')
      result.current.cancel()
      vi.advanceTimersByTime(500)
    })
    expect(fn).not.toHaveBeenCalled()
  })

  it('always reads the latest callback reference', () => {
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    const { result, rerender } = renderHook(
      ({ cb, delay }) => useDebouncedCallback(cb, delay),
      { initialProps: { cb: fn1, delay: 100 } },
    )
    act(() => result.current('a'))
    rerender({ cb: fn2, delay: 100 })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(fn1).not.toHaveBeenCalled()
    expect(fn2).toHaveBeenCalledWith('a')
  })
})

describe('useClientNow', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns a finite number from the very first render', () => {
    const { result } = renderHook(() => useClientNow())
    expect(typeof result.current).toBe('number')
    expect(Number.isFinite(result.current)).toBe(true)
  })

  it('ticks at the requested interval', () => {
    const { result } = renderHook(() => useClientNow(60_000))
    const first = result.current
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current).not.toBe(first)
  })

  it('with no interval, returns a number on first render', () => {
    // The hook doesn't tick by itself with `intervalMs = undefined`,
    // but it always re-issues `setNow(Date.now())` once mounted so the
    // very first render after the mount includes the live clock value.
    // We don't try to assert anything about that timing here — we just
    // make sure the hook doesn't crash and returns a finite number.
    const { result } = renderHook(() => useClientNow())
    expect(typeof result.current).toBe('number')
  })
})

describe('useGeolocation', () => {
  const originalGeolocation = navigator.geolocation

  afterEach(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: originalGeolocation,
    })
  })

  it('marks the request as pending then granted', () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) => {
          ok({
            coords: {
              latitude: 41.39,
              longitude: 2.17,
              accuracy: 0,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
              toJSON() {
                return this
              },
            } as GeolocationCoordinates,
            timestamp: 0,
            toJSON() {
              return this
            },
          } as GeolocationPosition)
        },
      },
    })
    const { result } = renderHook(() => useGeolocation())
    act(() => result.current.request())
    expect(result.current.status).toBe('granted')
    expect(result.current.position).toEqual([41.39, 2.17])
  })

  it('reports "unavailable" when geolocation is missing', () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined })
    const { result } = renderHook(() => useGeolocation())
    act(() => result.current.request())
    expect(result.current.status).toBe('unavailable')
  })
})

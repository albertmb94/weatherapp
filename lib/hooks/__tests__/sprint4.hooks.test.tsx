/**
 * Regression tests for S4 (extracted hooks layer).
 *
 * Auditoría: este fichero cubría además `useDebouncedCallback` y
 * `useGeolocation`, dos hooks que no importaba NADIE de la aplicación.
 * Se han eliminado junto con sus pruebas: un test que sólo ejercita
 * código muerto da una sensación de cobertura que no se corresponde con
 * nada que se ejecute en producción.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useClientNow } from '../useClientNow'

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

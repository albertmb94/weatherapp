/**
 * Tests for `useEffectiveProfile` (Sprint 13).
 *
 * The hook derives a `UsageProfile` from the location's terrain.
 * We mock `classifyTerrain` to avoid hitting the elevation API
 * during the test run; the mock returns a deterministic
 * `TerrainClassification` per test so we can pin the
 * `deriveProfileFromTerrain` mapping.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// Mock the backtest classifier module. Tests control what each
// call returns via `classifyTerrainMock.mockResolvedValueOnce(...)`.
const classifyTerrainMock = vi.fn()
vi.mock('@/lib/backtest/classifyTerrain', async () => {
  const actual = await vi.importActual<typeof import('@/lib/backtest/classifyTerrain')>('@/lib/backtest/classifyTerrain')
  return {
    ...actual,
    classifyTerrain: (...args: unknown[]) => classifyTerrainMock(...args),
  }
})

import { useEffectiveProfile, __resetEffectiveProfileCacheForTests } from '../useEffectiveProfile'

function coastalClassification() {
  return { type: 'coastal' as const, confidence: 0.85, elevation: 50 }
}

function mountainClassification() {
  return { type: 'mountain' as const, confidence: 0.9, elevation: 1500 }
}

describe('useEffectiveProfile', () => {
  beforeEach(() => {
    classifyTerrainMock.mockReset()
    __resetEffectiveProfileCacheForTests()
  })

  it('starts with profile=null and loading=false (no fetch yet)', () => {
    const { result } = renderHook(() => useEffectiveProfile(null, null))
    expect(result.current.profile).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('returns null while the classifier is in flight', async () => {
    let resolveFn: (value: unknown) => void = () => {}
    classifyTerrainMock.mockImplementationOnce(
      () => new Promise(resolve => { resolveFn = resolve })
    )
    const { result } = renderHook(() => useEffectiveProfile(41.39, 2.17))
    // The first effect tick kicks off the classifier; before it
    // resolves the hook returns loading=true, profile=null.
    expect(result.current.profile).toBeNull()
    expect(result.current.loading).toBe(true)
    // Resolve the classifier to clean up the pending promise.
    await act(async () => {
      resolveFn(coastalClassification())
    })
  })

  it('derives coastal from a coastal classification', async () => {
    classifyTerrainMock.mockResolvedValueOnce(coastalClassification())
    const { result } = renderHook(() => useEffectiveProfile(41.39, 2.17))
    await act(async () => {
      // wait for the async resolve
      await Promise.resolve()
    })
    expect(result.current.profile).toBe('coastal')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('derives mountain from a mountain classification', async () => {
    classifyTerrainMock.mockResolvedValueOnce(mountainClassification())
    const { result } = renderHook(() => useEffectiveProfile(46.5, 8.0))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.profile).toBe('mountain')
  })

  it('caches the result per lat/lon grid (≈1 km)', async () => {
    classifyTerrainMock.mockResolvedValue(coastalClassification())
    const first = renderHook(() => useEffectiveProfile(41.39, 2.17))
    await act(async () => {
      await Promise.resolve()
    })
    expect(first.result.current.profile).toBe('coastal')

    // Same coords (within the 2-decimal grid) → cache hit; no new
    // call to classifyTerrain. We use 41.39 + 1e-4 to stay inside
    // the same grid cell after toFixed rounding.
    const second = renderHook(() => useEffectiveProfile(41.3901, 2.1701))
    await act(async () => {
      await Promise.resolve()
    })
    expect(second.result.current.profile).toBe('coastal')
    // The second hook should have NOT triggered a fetch.
    expect(classifyTerrainMock).toHaveBeenCalledTimes(1)
  })

  it('makes a fresh call when the coords move to a different grid cell', async () => {
    classifyTerrainMock.mockResolvedValue(coastalClassification())
    renderHook(() => useEffectiveProfile(41.39, 2.17))
    await act(async () => {
      await Promise.resolve()
    })

    // Move ~0.05° away (≈5 km) — outside the 2-decimal cache grid.
    renderHook(() => useEffectiveProfile(41.45, 2.20))
    await act(async () => {
      await Promise.resolve()
    })
    expect(classifyTerrainMock).toHaveBeenCalledTimes(2)
  })

  it('captures errors from classifyTerrain', async () => {
    const err = new Error('boom')
    classifyTerrainMock.mockRejectedValueOnce(err)
    const { result } = renderHook(() => useEffectiveProfile(41.39, 2.17))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.profile).toBeNull()
    expect(result.current.error).toBe(err)
    expect(result.current.loading).toBe(false)
  })

  it('does not call classifyTerrain when both coords are null', async () => {
    renderHook(() => useEffectiveProfile(null, null))
    await act(async () => {
      await Promise.resolve()
    })
    expect(classifyTerrainMock).not.toHaveBeenCalled()
  })

  it('forwards the lat/lon to classifyTerrain', async () => {
    classifyTerrainMock.mockResolvedValueOnce(coastalClassification())
    renderHook(() => useEffectiveProfile(41.39, 2.17))
    await act(async () => {
      await Promise.resolve()
    })
    expect(classifyTerrainMock).toHaveBeenCalledWith(41.39, 2.17)
  })
})
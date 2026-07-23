import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useHourSlider } from '../useHourSlider'

describe('useHourSlider', () => {
  it('returns default max=336 when no models are selected', () => {
    const { result } = renderHook(() =>
      useHourSlider({
        selectedHour: 0,
        selectedRange: 336,
        selectedModels: [],
        viewTimesLength: 336,
      })
    )
    expect(result.current.maxModelHours).toBe(336)
    expect(result.current.effectiveMaxHours).toBe(336)
    expect(result.current.safeSelectedHour).toBe(0)
  })

  it('excludes marine_global from the maxModelHours calculation (M12)', () => {
    const { result } = renderHook(() =>
      useHourSlider({
        selectedHour: 0,
        selectedRange: 336,
        selectedModels: ['marine_global'],
        viewTimesLength: 336,
      })
    )
    // marine_global alone would clamp to 0 (its maxHours is 0).
    // We fall back to 336 instead.
    expect(result.current.maxModelHours).toBe(336)
  })

  it('picks the maximum forecast horizon across the selected models', () => {
    const { result } = renderHook(() =>
      useHourSlider({
        selectedHour: 0,
        selectedRange: 500,
        selectedModels: ['meteofrance_arome_france_hd', 'ecmwf_ifs'],
        // AROME-FR HD caps at 48 h, ECMWF IFS at 360 h
        viewTimesLength: 500,
      })
    )
    expect(result.current.maxModelHours).toBe(360)
    expect(result.current.effectiveMaxHours).toBe(360)
  })

  it('caps the slider at the smaller of range / maxModel / view length', () => {
    // range=48, maxModel=360, view=500 → effective = 48
    const { result } = renderHook(() =>
      useHourSlider({
        selectedHour: 0,
        selectedRange: 48,
        selectedModels: ['ecmwf_ifs'],
        viewTimesLength: 500,
      })
    )
    expect(result.current.effectiveMaxHours).toBe(48)
  })

  it('clamps selectedHour to [0, effectiveMaxHours - 1]', () => {
    const { result } = renderHook(() =>
      useHourSlider({
        selectedHour: 9999,
        selectedRange: 48,
        selectedModels: ['ecmwf_ifs'],
        viewTimesLength: 500,
      })
    )
    // effectiveMaxHours = 48, so safeSelectedHour = 47.
    expect(result.current.safeSelectedHour).toBe(47)
  })

  it('clamps a negative selectedHour to 0', () => {
    const { result } = renderHook(() =>
      useHourSlider({
        selectedHour: -5,
        selectedRange: 48,
        selectedModels: ['ecmwf_ifs'],
        viewTimesLength: 500,
      })
    )
    expect(result.current.safeSelectedHour).toBe(0)
  })

  it('returns effectiveMaxHours=1 with an empty view so the slider still works', () => {
    const { result } = renderHook(() =>
      useHourSlider({
        selectedHour: 0,
        selectedRange: 336,
        selectedModels: ['ecmwf_ifs'],
        viewTimesLength: 0,
      })
    )
    // With no view data we can't fully validate but we still need a
    // non-zero cap so the slider doesn't produce max=-1.
    expect(result.current.effectiveMaxHours).toBeGreaterThanOrEqual(1)
  })
})

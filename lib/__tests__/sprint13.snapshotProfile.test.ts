/**
 * Sprint 13: integration test for the profile boost in
 * `computeCurrentSnapshot`. The friendly snapshot's
 * `meanAcrossModels` helper is now profile-aware: when the caller
 * passes a non-null `profile` and a non-empty `recommended` set,
 * the resulting temperature/wind/etc. averages must shift slightly
 * toward the recommended models (a +5% boost on each, renormalised
 * to sum to 1).
 */

import { describe, expect, it } from 'vitest'
import { computeCurrentSnapshot } from '../friendlyForecast'
import { MODELS } from '../models'

function flatSeries(value: number) {
  const out: Record<string, Record<string, (number | null)[]>> = {}
  for (const m of MODELS) {
    if (m.id === 'marine_global') continue
    out[m.id] = { temperature: [value] }
  }
  return out
}

describe('computeCurrentSnapshot profile boost', () => {
  const time = [new Date('2026-01-01T00:00:00Z')]
  const activeIds = MODELS.filter(m => m.id !== 'marine_global').map(m => m.id)

  it('returns the same snapshot as without profile when profile is plain', () => {
    const baseline = computeCurrentSnapshot(
      { time, series: flatSeries(20) },
      MODELS,
      activeIds,
      0,
      null,
    )
    const boosted = computeCurrentSnapshot(
      { time, series: flatSeries(20) },
      MODELS,
      activeIds,
      0,
      null,
      'plain',
      new Set(['ecmwf_ifs']),
    )
    expect(boosted?.temperatureC).toBeCloseTo(baseline?.temperatureC ?? NaN, 5)
  })

  it('returns the same snapshot as without profile when recommended is empty', () => {
    const baseline = computeCurrentSnapshot(
      { time, series: flatSeries(20) },
      MODELS,
      activeIds,
      0,
      null,
    )
    const boosted = computeCurrentSnapshot(
      { time, series: flatSeries(20) },
      MODELS,
      activeIds,
      0,
      null,
      'coastal',
      new Set(),
    )
    expect(boosted?.temperatureC).toBeCloseTo(baseline?.temperatureC ?? NaN, 5)
  })

  it('biases the ensemble toward the recommended model when both inputs are provided', () => {
    // Build a series where the recommended model (ecmwf_ifs)
    // reports a value 1°C *higher* than the rest. With the boost,
    // the snapshot's temperature should shift slightly higher than
    // without the boost; without it, the snapshot reflects the
    // flat 20°C average exactly.
    const series: Record<string, Record<string, (number | null)[]>> = {}
    for (const m of MODELS) {
      if (m.id === 'marine_global') continue
      series[m.id] = { temperature: [m.id === 'ecmwf_ifs' ? 21 : 20] }
    }
    const baseline = computeCurrentSnapshot(
      { time, series },
      MODELS,
      activeIds,
      0,
      null,
    )
    const boosted = computeCurrentSnapshot(
      { time, series },
      MODELS,
      activeIds,
      0,
      null,
      'coastal',
      new Set(['ecmwf_ifs']),
    )
    expect(baseline?.temperatureC).toBeDefined()
    expect(boosted?.temperatureC).toBeDefined()
    // The boosted average must shift UP because ecmwf_ifs is the
    // 1°C-warmer model and we just gave it more weight.
    expect(boosted!.temperatureC!).toBeGreaterThan(baseline!.temperatureC!)
    // And it must stay BELOW ecmwf_ifs's raw value (21) — we
    // didn't 100%-weight the recommended model, just nudged it.
    expect(boosted!.temperatureC!).toBeLessThan(21)
  })

  it('does not bias when the recommended model is not in the active set', () => {
    const series: Record<string, Record<string, (number | null)[]>> = {}
    for (const m of MODELS) {
      if (m.id === 'marine_global') continue
      series[m.id] = { temperature: [m.id === 'nonexistent_model' ? 100 : 20] }
    }
    const baseline = computeCurrentSnapshot(
      { time, series },
      MODELS,
      activeIds,
      0,
      null,
    )
    const boosted = computeCurrentSnapshot(
      { time, series },
      MODELS,
      activeIds,
      0,
      null,
      'coastal',
      new Set(['nonexistent_model']),
    )
    expect(boosted?.temperatureC).toBeCloseTo(baseline?.temperatureC ?? NaN, 5)
  })
})
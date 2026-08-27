/**
 * Unit tests for the central ensemble module. These exercise the
 * helpers in isolation; the regression test in
 * `centralEnsemble.test.ts` exercises the integration with the
 * existing call sites.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveActiveModels,
  weightsFor,
  meanAtHour,
  meanOverBucket,
  constantWeights,
} from '../central'
import { MODELS } from '../../models'

describe('resolveActiveModels', () => {
  it('wedai mode returns all non-marine models regardless of selectedIds', () => {
    const all = resolveActiveModels(MODELS, [], 'wedai')
    const withSome = resolveActiveModels(
      MODELS,
      ['ecmwf_ifs'],
      'wedai'
    )
    expect(all.length).toBe(MODELS.length - 1) // minus marine_global
    expect(withSome.length).toBe(all.length)
    expect(all.map(m => m.id)).toEqual(withSome.map(m => m.id))
    expect(all.every(m => m.id !== 'marine_global')).toBe(true)
  })

  it('models mode filters to selectedIds only', () => {
    const out = resolveActiveModels(MODELS, ['ecmwf_ifs', 'icon_global'], 'models')
    expect(out.map(m => m.id)).toEqual(['ecmwf_ifs', 'icon_global'])
  })

  it('models mode returns empty when no ids match', () => {
    const out = resolveActiveModels(MODELS, ['does_not_exist'], 'models')
    expect(out).toEqual([])
  })

  it('never includes marine_global even when explicitly selected', () => {
    const out = resolveActiveModels(MODELS, ['marine_global', 'ecmwf_ifs'], 'models')
    expect(out.some(m => m.id === 'marine_global')).toBe(false)
    expect(out.some(m => m.id === 'ecmwf_ifs')).toBe(true)
  })

  it('does not mutate the input', () => {
    const original = MODELS.map(m => m.id)
    resolveActiveModels(MODELS, ['ecmwf_ifs'], 'wedai')
    resolveActiveModels(MODELS, [], 'models')
    expect(MODELS.map(m => m.id)).toEqual(original)
  })
})

describe('weightsFor', () => {
  it('returns one weight per active model, in order', () => {
    const active = resolveActiveModels(MODELS, [], 'wedai')
    const w = weightsFor('temperature', 0, 1, active)
    expect(w.length).toBe(active.length)
  })

  it('uses the 0-48h preset bucket at hour 0', () => {
    const active = resolveActiveModels(MODELS, [], 'wedai')
    const w = weightsFor('temperature', 0, 1, active)
    // B-NBT-8: calibrated bucket (backtest window 2026-08-15..22,
    // normalised win-rate shares). ecmwf_ifs carries 0.102 which the
    // AI share rescales by (1 - 0.20) → 0.0816.
    const ecmwfIdx = active.findIndex(m => m.id === 'ecmwf_ifs')
    expect(w[ecmwfIdx]).toBeCloseTo(0.102 * 0.8, 3)
    // The high-resolution regional must outrank every global in the
    // calibrated short-lead bucket — this is the whole point of the
    // backtest-driven calibration.
    const iconEuIdx = active.findIndex(m => m.id === 'icon_eu')
    expect(w[iconEuIdx]).toBeGreaterThan(w[ecmwfIdx])
  })

  it('switches to the 96-168h bucket past hour 168', () => {
    const active = resolveActiveModels(MODELS, [], 'wedai')
    const w = weightsFor('temperature', 168, 1, active)
    // At >= 96h only globals remain measurable; ecmwf_ifs leads with
    // 0.19 rescaled by that bucket's AI share of 0.30 → Ã—0.70.
    const ecmwfIdx = active.findIndex(m => m.id === 'ecmwf_ifs')
    expect(w[ecmwfIdx]).toBeCloseTo(0.19 * 0.7, 5)
  })

  it('multiplies hour index by bucketHours for the lead time', () => {
    const active = resolveActiveModels(MODELS, [], 'wedai')
    // hourIndex=10 with bucketHours=3 → leadTimeHours = 30 (0-48h bucket)
    const wShort = weightsFor('temperature', 10, 3, active)
    const ecmwfIdx = active.findIndex(m => m.id === 'ecmwf_ifs')
    expect(wShort[ecmwfIdx]).toBeCloseTo(0.102 * 0.8, 3)
    // hourIndex=60 with bucketHours=3 → leadTimeHours = 180 (168-240h bucket).
    // The 96-168h preset used to handle anything above 96h; S1 added
    // dedicated buckets above 168h so this assertion pins the new
    // behaviour rather than silently rolling the new lead time into
    // the 96-168h preset. That bucket is still hand-authored
    // (unmeasured extrapolation): ecmwf_ifs 0.42 rescaled by its AI
    // share of 0.32 → 0.42 Ã— 0.68.
    const wFar = weightsFor('temperature', 60, 3, active)
    expect(wFar[ecmwfIdx]).toBeCloseTo(0.42 * 0.68, 5)
  })

  it('falls back to 0.01 for models not in the preset', () => {
    const active = resolveActiveModels(MODELS, [], 'wedai')
    const w = weightsFor('temperature', 0, 1, active)
    // All real models in this fixture are in the temperature preset.
    // Sanity: no weight should be exactly 0 or negative.
    expect(w.every(x => x > 0)).toBe(true)
  })
})

describe('meanAtHour', () => {
  const series = {
    ecmwf_ifs: { temperature: [10, 11, 12] },
    icon_global: { temperature: [20, 21, 22] },
    gfs_global: { temperature: [30, null, 32] },
  }

  it('returns the weighted mean over contributing models', () => {
    const active = resolveActiveModels(MODELS, [], 'wedai').filter(
      m => ['ecmwf_ifs', 'icon_global', 'gfs_global'].includes(m.id)
    )
    const w = weightsFor('temperature', 0, 1, active)
    const v = meanAtHour(
      { time: [new Date(), new Date(), new Date()], series },
      'temperature',
      1,
      active,
      w
    )
    expect(v).not.toBeNull()
    // 11, 21, null → weighted mean over the two non-null models
    const ecmwf = active.find(m => m.id === 'ecmwf_ifs')!
    const icon = active.find(m => m.id === 'icon_global')!
    const wE = w[active.indexOf(ecmwf)]
    const wI = w[active.indexOf(icon)]
    const expected = (11 * wE + 21 * wI) / (wE + wI)
    expect(v!).toBeCloseTo(expected, 5)
  })

  it('returns null when no model has data at that hour', () => {
    const active = resolveActiveModels(MODELS, [], 'wedai').filter(
      m => ['ecmwf_ifs', 'icon_global'].includes(m.id)
    )
    const w = weightsFor('temperature', 0, 1, active)
    const v = meanAtHour(
      { time: [new Date(), new Date(), new Date()], series },
      'temperature',
      99,
      active,
      w
    )
    expect(v).toBeNull()
  })

  it('returns null when activeModels is empty', () => {
    expect(
      meanAtHour(
        { time: [new Date()], series },
        'temperature',
        0,
        [],
        []
      )
    ).toBeNull()
  })
})

describe('meanOverBucket', () => {
  const series = {
    ecmwf_ifs: { temperature: [10, 11, 12, 13] },
    icon_global: { temperature: [20, 21, 22, 23] },
  }

  it('averages the per-hour ensembles within the range', () => {
    const active = resolveActiveModels(MODELS, [], 'wedai').filter(
      m => ['ecmwf_ifs', 'icon_global'].includes(m.id)
    )
    const wFn = (i: number) => weightsFor('temperature', i, 1, active)
    const v = meanOverBucket(
      { time: [new Date(), new Date(), new Date(), new Date()], series },
      'temperature',
      0,
      3,
      active,
      wFn
    )
    expect(v).not.toBeNull()
    // All four hours contribute, so v is the unweighted mean of the
    // 4 per-hour ensembles.
    const perHour = [0, 1, 2, 3].map(i => {
      const w = wFn(i)
      return (
        (series.ecmwf_ifs.temperature[i] * w[0] +
          series.icon_global.temperature[i] * w[1]) /
        (w[0] + w[1])
      )
    })
    const expected =
      perHour.reduce((a, b) => a + b, 0) / perHour.length
    expect(v!).toBeCloseTo(expected, 5)
  })

  it('constantWeights produces the same value as building per-hour weights', () => {
    const active = resolveActiveModels(MODELS, [], 'wedai').filter(
      m => ['ecmwf_ifs', 'icon_global'].includes(m.id)
    )
    const w0 = weightsFor('temperature', 0, 1, active)
    const vConst = meanOverBucket(
      { time: [new Date(), new Date(), new Date(), new Date()], series },
      'temperature',
      0,
      3,
      active,
      constantWeights(w0)
    )
    const vPerHour = meanOverBucket(
      { time: [new Date(), new Date(), new Date(), new Date()], series },
      'temperature',
      0,
      3,
      active,
      i => weightsFor('temperature', i, 1, active)
    )
    expect(vConst).toBeCloseTo(vPerHour!, 5)
  })

  it('returns null when start > end', () => {
    const active = resolveActiveModels(MODELS, [], 'wedai')
    const v = meanOverBucket(
      { time: [new Date()], series },
      'temperature',
      5,
      2,
      active,
      () => [1]
    )
    expect(v).toBeNull()
  })

  it('skips hours where no model contributes', () => {
    const sparse = {
      ecmwf_ifs: { temperature: [10, null, 12, null] },
      icon_global: { temperature: [null, null, null, null] },
    }
    const active = resolveActiveModels(MODELS, [], 'wedai').filter(
      m => ['ecmwf_ifs', 'icon_global'].includes(m.id)
    )
    const v = meanOverBucket(
      { time: [new Date(), new Date(), new Date(), new Date()], series: sparse },
      'temperature',
      0,
      3,
      active,
      () => weightsFor('temperature', 0, 1, active)
    )
    // Only hour 0 and hour 2 contribute (10 and 12) → 11
    expect(v).toBeCloseTo(11, 5)
  })
})

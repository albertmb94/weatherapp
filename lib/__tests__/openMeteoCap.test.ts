import { describe, it, expect } from 'vitest'
import { capModels } from '../openMeteo'
import { MODELS } from '../models'

// `capModels` belongs to lib/openMeteo.ts and gates the model list that
// gets sent to Open-Meteo. The DailySummary's long-range coverage
// (B-NEW-1) depends on it: if the cap drops every long-range model, the
// ensemble panel goes blank past ~7 days. These tests pin the contract.

describe('capModels — long-range fallback (B-NEW-1)', () => {
  it('keeps at least one long-range model when the regional tier fills the cap', () => {
    // Europe-tier selection: 7 regional, 5 global, 3 AI = 15 models.
    const europe = MODELS.filter(m => m.id !== 'marine_global')
    const capped = capModels(europe, 10, 16)
    expect(capped.length).toBeGreaterThanOrEqual(10)
    const longRange = capped.filter(m => m.maxHours >= 16 * 24)
    expect(longRange.length).toBeGreaterThanOrEqual(2)
    // GFS (384h) is the widely-covered long-range workhorse for Europe
    // and must always be part of the capped set.
    expect(capped.some(m => m.id === 'gfs_global')).toBe(true)
  })

  it('returns the source list unchanged when within the cap', () => {
    const three = MODELS.filter(m => ['ecmwf_ifs', 'icon_global', 'gfs_global'].includes(m.id))
    const result = capModels(three, 10)
    expect(result.length).toBe(3)
    expect(result.map(m => m.id)).toEqual(['ecmwf_ifs', 'icon_global', 'gfs_global'])
  })

  it('enforces the cap for short forecasts regardless of long-range fallback', () => {
    const europe = MODELS.filter(m => m.id !== 'marine_global')
    const capped = capModels(europe, 3, 1)
    expect(capped.length).toBe(3)
  })

  it('appends long-range models when the original cap lacks any', () => {
    // 5 short-range regional models + 1 long-range global → cap at 4.
    // Without the fallback the global would be dropped.
    const regional = MODELS.filter(m => ['meteofrance_arome_france_hd', 'dwd_icon_d2', 'dmi_harmonie_arome_europe', 'meteofrance_arome_france', 'gfs_global'].includes(m.id))
    const capped = capModels(regional, 4, 16)
    expect(capped.length).toBeGreaterThanOrEqual(4)
    expect(capped.some(m => m.id === 'gfs_global')).toBe(true)
  })
})

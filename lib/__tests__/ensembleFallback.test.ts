import { describe, it, expect } from 'vitest'
import { ensembleWithFallback } from '../ensemble/central'
import type { WeatherModel } from '../models'

// B-NEW-6: the production API (after B-NEW-3 in lib/openMeteo.ts) only
// returns 5 long-range models. A user who selects only a short-range
// model (e.g. meteofrance_arome_france_hd) used to see a table full
// of em-dashes because the selected model has no entry in `series`.
// `ensembleWithFallback` falls back to the full land-model set so
// the table always shows a value when at least one model has data.

const LONG_RANGE = [
  { id: 'ecmwf_ifs', label: 'ECMWF', color: '#000', maxHours: 360, weight: 30, type: 'deterministic' as const, region: 'global' as const },
  { id: 'gfs_global', label: 'GFS', color: '#000', maxHours: 384, weight: 14, type: 'deterministic' as const, region: 'global' as const },
  { id: 'ncep_aigfs025', label: 'AIGFS', color: '#000', maxHours: 384, weight: 10, type: 'ai' as const, region: 'global' as const },
]

const SHORT_RANGE: WeatherModel = {
  id: 'meteofrance_arome_france_hd',
  label: 'AROME-FRHD',
  color: '#000',
  maxHours: 48,
  weight: 20,
  type: 'deterministic',
  region: 'europe',
}

const LENGTH = 384

// Build a series map containing data only for the long-range models.
// This mirrors the production state where the API request was filtered
// to long-range models and the short-range keys are absent.
function buildLongRangeOnlySeries() {
  const series: Record<string, Record<string, (number | null)[]>> = {}
  for (const m of LONG_RANGE) {
    series[m.id] = {
      temperature: Array.from({ length: LENGTH }, (_, i) => 20 + (i % 24) * 0.5),
      precipitation: Array.from({ length: LENGTH }, () => 0),
    }
  }
  return series
}

const evenWeights = LONG_RANGE.map(() => 1)

describe('ensembleWithFallback (B-NEW-6)', () => {
  it('returns the user mean when the selected model has data', () => {
    const series = buildLongRangeOnlySeries()
    // User selected only gfs_global — the long-range model. It has
    // data at every index, so the helper returns the model's value.
    const v = ensembleWithFallback(
      series, 'temperature', 12, [LONG_RANGE[1]], LONG_RANGE, [1]
    )
    expect(v).not.toBeNull()
    expect(v).toBeCloseTo(20 + (12 % 24) * 0.5, 5)
  })

  it('falls back to WedAI when the selected model has no data', () => {
    const series = buildLongRangeOnlySeries()
    // User selected only a short-range model that has no series entry.
    // Without the fallback, the mean would be null (the table would
    // show em-dashes). With the fallback, the helper returns the mean
    // of the full long-range set, which DOES have data.
    const v = ensembleWithFallback(
      series, 'temperature', 12, [SHORT_RANGE], LONG_RANGE, [1]
    )
    expect(v).not.toBeNull()
  })

  it('returns null when both selection and WedAI have no data', () => {
    const series: Record<string, Record<string, (number | null)[]>> = {}
    // Empty series — no model has data anywhere.
    const v = ensembleWithFallback(
      series, 'temperature', 12, [SHORT_RANGE], LONG_RANGE, [1]
    )
    expect(v).toBeNull()
  })

  it('returns null when the selection is empty', () => {
    const series = buildLongRangeOnlySeries()
    const v = ensembleWithFallback(
      series, 'temperature', 12, [], LONG_RANGE, []
    )
    expect(v).toBeNull()
  })

  it('preserves the user mean when no fallback is needed', () => {
    const series = buildLongRangeOnlySeries()
    // User selected only gfs_global and ecmwf_ifs (both have data).
    // The helper should return the weighted mean of those two models
    // — not the WedAI mean.
    const v = ensembleWithFallback(
      series, 'temperature', 12,
      [LONG_RANGE[0], LONG_RANGE[1]], LONG_RANGE,
      [1, 1, 1]
    )
    expect(v).not.toBeNull()
    const expected = (20 + (12 % 24) * 0.5 + 20 + (12 % 24) * 0.5) / 2
    expect(v).toBeCloseTo(expected, 5)
  })
})

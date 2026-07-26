/**
 * Regression tests for S10 — probabilities and daily aggregates.
 *
 * These pin the public contract of `weightedAvg` (with bias
 * correction) and the ForecastResult daily fields so the new path
 * can't regress with a follow-up commit.
 */

import { describe, expect, it } from 'vitest'
import { weightedAvg } from '@/lib/ensemble'

describe('S10 — weightedAvg bias correction uses the supplied map', () => {
  it('subtracts per-model bias before averaging', () => {
    const v = weightedAvg([10, 20], [1, 1], null, ['a', 'b'], { a: 5, b: 0 })
    expect(v).toBe(12.5)
  })

  it('is a no-op when no bias map is provided', () => {
    expect(weightedAvg([10, 20], [1, 1])).toBe(15)
  })

  it('treats NaN bias as zero', () => {
    expect(weightedAvg([10, 20], [1, 1], null, ['a', 'b'], { a: Number.NaN, b: 0 })).toBe(15)
  })
})

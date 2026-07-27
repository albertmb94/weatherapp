/**
 * Tests for the F5 air-quality helpers.
 *
 * The AQI band classifier is pure and easy to pin. We don't
 * stub the network because the data fetching lives in
 * `lib/openMeteo.ts` / `app/api/air-quality/route.ts` and is
 * covered by their own tests.
 */
import { describe, expect, it } from 'vitest'
import { classifyEuropeanAqi } from '../airQuality'

describe('classifyEuropeanAqi', () => {
  it('returns null for missing values', () => {
    expect(classifyEuropeanAqi(null)).toBeNull()
    expect(classifyEuropeanAqi(undefined)).toBeNull()
    expect(classifyEuropeanAqi(NaN)).toBeNull()
  })

  it('classifies the lower bands', () => {
    expect(classifyEuropeanAqi(0)?.band).toBe('good')
    expect(classifyEuropeanAqi(15)?.band).toBe('good')
    expect(classifyEuropeanAqi(20)?.band).toBe('fair')
    expect(classifyEuropeanAqi(35)?.band).toBe('fair')
    expect(classifyEuropeanAqi(40)?.band).toBe('moderate')
    expect(classifyEuropeanAqi(55)?.band).toBe('moderate')
  })

  it('classifies the higher bands', () => {
    expect(classifyEuropeanAqi(60)?.band).toBe('poor')
    expect(classifyEuropeanAqi(75)?.band).toBe('poor')
    expect(classifyEuropeanAqi(80)?.band).toBe('very_poor')
    expect(classifyEuropeanAqi(99)?.band).toBe('very_poor')
    expect(classifyEuropeanAqi(100)?.band).toBe('extreme')
    expect(classifyEuropeanAqi(150)?.band).toBe('extreme')
  })

  it('returns a Spanish label and an accessibility hint', () => {
    const r = classifyEuropeanAqi(50)
    expect(r?.label.length).toBeGreaterThan(0)
    expect(r?.hint.length).toBeGreaterThan(0)
  })
})

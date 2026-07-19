import { describe, it, expect, vi, afterEach } from 'vitest'
import { rateLimit } from '../rateLimit'

describe('rateLimit', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('allows request when bucket has tokens', () => {
    expect(rateLimit('test-allow', 10)).toBe(true)
  })

  it('consumes a token per call', () => {
    const key = 'test-consume'
    for (let i = 0; i < 10; i++) {
      expect(rateLimit(key, 10)).toBe(true)
    }
    expect(rateLimit(key, 10)).toBe(false)
  })

  it('refills tokens over time', () => {
    const key = 'test-refill'
    // Exhaust tokens
    for (let i = 0; i < 5; i++) rateLimit(key, 5)
    expect(rateLimit(key, 5)).toBe(false)

    // Advance time by 60 seconds (full window)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000)
    expect(rateLimit(key, 5)).toBe(true)
  })

  it('isolates buckets by key', () => {
    const key1 = 'test-iso-1'
    const key2 = 'test-iso-2'
    // Exhaust key1
    for (let i = 0; i < 5; i++) rateLimit(key1, 5)
    expect(rateLimit(key1, 5)).toBe(false)
    // key2 should still have tokens
    expect(rateLimit(key2, 5)).toBe(true)
  })

  it('allows custom maxTokens', () => {
    const key = 'test-custom'
    expect(rateLimit(key, 2)).toBe(true)
    expect(rateLimit(key, 2)).toBe(true)
    expect(rateLimit(key, 2)).toBe(false)
  })

  it('refills partially', () => {
    const key = 'test-partial'
    // Exhaust tokens
    for (let i = 0; i < 10; i++) rateLimit(key, 10)
    expect(rateLimit(key, 10)).toBe(false)

    // Advance 30 seconds (half window = 50% refill)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000)
    // Should get ~5 tokens back
    let allowed = 0
    for (let i = 0; i < 6; i++) {
      if (rateLimit(key, 10)) allowed++
    }
    expect(allowed).toBeGreaterThanOrEqual(4)
    expect(allowed).toBeLessThanOrEqual(6)
  })
})

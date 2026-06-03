import { describe, it, expect } from 'vitest'
import { weightedAvg, contrastText } from '../ensemble'

describe('weightedAvg', () => {
  it('returns null for all null values', () => {
    expect(weightedAvg([null, null], [1, 1])).toBeNull()
  })

  it('returns weighted average of non-null values', () => {
    expect(weightedAvg([10, 20], [1, 1])).toBe(15)
  })

  it('weights values correctly', () => {
    expect(weightedAvg([10, 20], [3, 1])).toBe(12.5)
  })

  it('skips null entries and reweights', () => {
    expect(weightedAvg([10, null, 30], [1, 1, 1])).toBe(20)
  })

  it('handles single value', () => {
    expect(weightedAvg([42], [1])).toBe(42)
  })

  it('handles undefined entries', () => {
    expect(weightedAvg([10, undefined as unknown as number, 30], [1, 1, 1])).toBe(20)
  })
})

describe('contrastText', () => {
  it('returns dark text for light backgrounds', () => {
    expect(contrastText('rgb(255,255,255)')).toBe('#0a0a0a')
  })

  it('returns light text for dark backgrounds', () => {
    expect(contrastText('rgb(0,0,0)')).toBe('#fff')
  })

  it('returns dark text for yellow', () => {
    expect(contrastText('rgb(255,255,0)')).toBe('#0a0a0a')
  })

  it('returns light text for blue', () => {
    expect(contrastText('rgb(0,0,200)')).toBe('#fff')
  })

  it('returns white for invalid input', () => {
    expect(contrastText('invalid')).toBe('#fff')
  })
})

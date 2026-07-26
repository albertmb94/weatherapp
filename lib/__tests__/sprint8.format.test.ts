/**
 * Regression tests for S8 (unified formatters).
 */

import { describe, expect, it } from 'vitest'
import {
  fmtNow,
  fmtPercent,
  fmtTemp,
  fmtKmh,
  fmtMm,
} from '../format'

describe('fmtTemp', () => {
  it('rounds to the nearest integer and appends the unit', () => {
    expect(fmtTemp(15.6, 'es')).toBe('16°C')
    expect(fmtTemp(-2.4, 'en')).toBe('-2°C')
  })
  it('emits a dash for null / NaN', () => {
    expect(fmtTemp(null, 'es')).toBe('–')
    expect(fmtTemp(NaN, 'es')).toBe('–')
  })
})

describe('fmtPercent', () => {
  it('rounds and appends %', () => {
    expect(fmtPercent(0, 'es')).toBe('0%')
    expect(fmtPercent(74.4, 'en')).toBe('74%')
  })
})

describe('fmtKmh / fmtMm', () => {
  it('round km/h to integer', () => {
    expect(fmtKmh(12.6, 'es')).toBe('13')
  })
  it('print mm with one decimal', () => {
    expect(fmtMm(2.04, 'es')).toBe('2.0')
  })
})

describe('fmtNow', () => {
  it('localises the "now" label', () => {
    expect(fmtNow('en')).toBe('now')
    expect(fmtNow('es')).toBe('ahora')
  })
})

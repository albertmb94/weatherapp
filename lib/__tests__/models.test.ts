import { describe, it, expect } from 'vitest'
import { MODELS, METRICS } from '../models'

describe('MODELS', () => {
  it('has at least one model', () => {
    expect(MODELS.length).toBeGreaterThan(0)
  })

  it('each model has required fields', () => {
    for (const m of MODELS) {
      expect(m.id).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.color).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(m.maxHours).toBeGreaterThan(0)
      expect(m.weight).toBeGreaterThan(0)
    }
  })

  it('has unique ids', () => {
    const ids = MODELS.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has models covering at least 240 hours (10 days)', () => {
    const maxMaxHours = Math.max(...MODELS.map(m => m.maxHours))
    expect(maxMaxHours).toBeGreaterThanOrEqual(240)
  })
})

describe('METRICS', () => {
  it('has an "all" metric', () => {
    expect(METRICS.some(m => m.id === 'all')).toBe(true)
  })

  it('each metric has required fields', () => {
    for (const m of METRICS) {
      expect(m.id).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.unit).toBeDefined()
      if (m.id !== 'all') {
        expect(m.hourlyParam).toBeTruthy()
      }
    }
  })

  it('has unique ids', () => {
    const ids = METRICS.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique hourlyParam for non-all metrics', () => {
    const nonAll = METRICS.filter(m => m.id !== 'all')
    const params = nonAll.map(m => m.hourlyParam)
    expect(new Set(params).size).toBe(params.length)
  })
})

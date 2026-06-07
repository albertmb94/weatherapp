import { describe, it, expect } from 'vitest'
import { MODELS, METRICS, MARINE_METRIC_IDS } from '../models'

describe('MODELS', () => {
  it('has at least one model', () => {
    expect(MODELS.length).toBeGreaterThan(0)
  })

  it('each model has required fields', () => {
    for (const m of MODELS) {
      expect(m.id).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.color).toMatch(/^#[0-9a-fA-F]{6}$/)
      // maxHours is 0 for the virtual marine_global model (excluded from forecast API).
      expect(m.maxHours).toBeGreaterThanOrEqual(0)
      // weight may be 0 for the virtual single-source 'marine_global' model.
      expect(m.weight).toBeGreaterThanOrEqual(0)
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

  it('classifies metrics into land and marine groups', () => {
    const land = METRICS.filter(m => m.group === 'land' && m.id !== 'all')
    const marine = METRICS.filter(m => m.group === 'marine')
    expect(land.length).toBeGreaterThan(0)
    expect(marine.length).toBeGreaterThan(0)
    for (const m of marine) {
      expect(MARINE_METRIC_IDS).toContain(m.id)
    }
  })
})

describe('marine_global model', () => {
  it('exists in MODELS with weight 0 and maxHours 0 so it is excluded from forecast API requests', () => {
    const m = MODELS.find(mm => mm.id === 'marine_global')
    expect(m).toBeDefined()
    expect(m?.weight).toBe(0)
    expect(m?.maxHours).toBe(0)
  })
})

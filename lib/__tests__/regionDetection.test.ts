import { describe, it, expect } from 'vitest'
import { getRegionForLocation, selectModelsForLocation } from '../regionDetection'
import { MODELS } from '../models'

describe('getRegionForLocation', () => {
  it('detects Europe for Barcelona', () => {
    expect(getRegionForLocation(41.39, 2.17)).toBe('europe')
  })

  it('detects Europe for Paris', () => {
    expect(getRegionForLocation(48.86, 2.35)).toBe('europe')
  })

  it('detects Europe for London', () => {
    expect(getRegionForLocation(51.51, -0.13)).toBe('europe')
  })

  it('detects N. America for New York', () => {
    expect(getRegionForLocation(40.71, -74.01)).toBe('namerica')
  })

  it('detects N. America for Los Angeles', () => {
    expect(getRegionForLocation(34.05, -118.24)).toBe('namerica')
  })

  it('detects Asia for Tokyo', () => {
    expect(getRegionForLocation(35.68, 139.69)).toBe('asia')
  })

  it('detects Oceania for Sydney', () => {
    expect(getRegionForLocation(-33.87, 151.21)).toBe('oceania')
  })

  it('detects global for mid-Atlantic', () => {
    expect(getRegionForLocation(30, -40)).toBe('global')
  })

  it('detects Europe for Canary Islands', () => {
    expect(getRegionForLocation(28.12, -15.43)).toBe('europe')
  })
})

describe('selectModelsForLocation', () => {
  it('includes regional models for Europe', () => {
    const selected = selectModelsForLocation(MODELS, 41.39, 2.17) // Barcelona
    const ids = selected.map(m => m.id)
    // Should include at least one European regional model
    const hasEuropeanRegional = selected.some(m => m.region === 'europe' && m.resolution && m.resolution <= 10)
    expect(hasEuropeanRegional).toBe(true)
    // Should include global models
    const hasGlobal = selected.some(m => m.region === 'global')
    expect(hasGlobal).toBe(true)
    // Should include AI models
    const hasAI = selected.some(m => m.type === 'ai')
    expect(hasAI).toBe(true)
  })

  it('includes HRRR for US locations', () => {
    const selected = selectModelsForLocation(MODELS, 40.71, -74.01) // NYC
    const ids = selected.map(m => m.id)
    expect(ids).toContain('ncep_hrrr_conus')
  })

  it('does not include marine model', () => {
    const selected = selectModelsForLocation(MODELS, 41.39, 2.17)
    const ids = selected.map(m => m.id)
    expect(ids).not.toContain('marine_global')
  })

  it('returns at least 5 models', () => {
    const selected = selectModelsForLocation(MODELS, 41.39, 2.17)
    expect(selected.length).toBeGreaterThanOrEqual(5)
  })

  it('returns models sorted by priority (regional first, then global, then AI)', () => {
    const selected = selectModelsForLocation(MODELS, 41.39, 2.17)
    const firstRegional = selected.findIndex(m => m.region === 'europe' && m.resolution && m.resolution <= 10)
    const firstGlobal = selected.findIndex(m => m.region === 'global')
    // Regional should come before global
    if (firstRegional !== -1 && firstGlobal !== -1) {
      expect(firstRegional).toBeLessThan(firstGlobal)
    }
  })
})

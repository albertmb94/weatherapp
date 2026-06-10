import { describe, it, expect } from 'vitest'
import { resolveMeteoclimaticPrefix } from '../meteoclimaticProvinces'

describe('resolveMeteoclimaticPrefix', () => {
  it('resolves a point in Barcelona to ESCAT08', () => {
    expect(resolveMeteoclimaticPrefix(41.39, 2.17)).toBe('ESCAT08')
  })

  it('resolves a point in Madrid to ESMAD28', () => {
    expect(resolveMeteoclimaticPrefix(40.42, -3.70)).toBe('ESMAD28')
  })

  it('resolves a point in Valencia to ESPVA46', () => {
    expect(resolveMeteoclimaticPrefix(39.47, -0.38)).toBe('ESPVA46')
  })

  it('resolves a point in Palma de Mallorca to ESBAL07', () => {
    expect(resolveMeteoclimaticPrefix(39.57, 2.65)).toBe('ESBAL07')
  })

  it('resolves a point in Las Palmas to ESCAN35', () => {
    expect(resolveMeteoclimaticPrefix(28.12, -15.44)).toBe('ESCAN35')
  })

  it('resolves a point in Bilbao to ESPVA48', () => {
    expect(resolveMeteoclimaticPrefix(43.26, -2.93)).toBe('ESPVA48')
  })

  it('returns null for a point outside Spain (Berlin)', () => {
    expect(resolveMeteoclimaticPrefix(52.52, 13.40)).toBeNull()
  })

  it('returns null for a point outside Spain (Paris)', () => {
    expect(resolveMeteoclimaticPrefix(48.85, 2.35)).toBeNull()
  })

  it('returns null for a point in the middle of the Atlantic', () => {
    expect(resolveMeteoclimaticPrefix(30.0, -30.0)).toBeNull()
  })

  it('picks the nearest province on a border overlap', () => {
    // A point near the Huesca / Lleida border. Both bboxes may match; the
    // algorithm should pick the closer centroid.
    // (Huesca centroid is roughly (0.0, 42.0); Lleida centroid (1.1, 42.2).)
    const nearHuesca = resolveMeteoclimaticPrefix(42.0, 0.1)
    const nearLleida = resolveMeteoclimaticPrefix(42.0, 1.1)
    expect(nearHuesca).toBe('ESARA22')
    expect(nearLleida).toBe('ESCAT25')
  })

  it('falls back to nearest centroid for a coastal/offshore point', () => {
    // A point just off the Barcelona coast (~ 5 km from the BCN bbox).
    const r = resolveMeteoclimaticPrefix(41.31, 2.50)
    expect(r).toBe('ESCAT08')
  })

  it('handles a point exactly on a province border', () => {
    // Just south of the Barcelona bbox: should still resolve to Barcelona
    // via the 100 km centroid fallback.
    const r = resolveMeteoclimaticPrefix(41.30, 2.20)
    expect(r).toBe('ESCAT08')
  })
})

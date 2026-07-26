/**
 * Tests for `lib/profiles.ts` — Sprint 13.
 *
 * Verifies the mapping from a `TerrainClassification` (raw output of
 * `classifyTerrain`) to a `UsageProfile`. The previous hardcoded
 * preference table (`PROFILE_RECOMMENDATIONS`) was deleted because
 * the model boost is now driven by the backtest database; this module
 * keeps the mapping deterministic and pure.
 */

import { describe, it, expect } from 'vitest'
import {
  deriveProfileFromTerrain,
  profilesAreEqual,
  PROFILE_ORDER,
  PROFILE_LABELS,
  PROFILE_LABELS_EN,
  getProfileRecommendation,
  type UsageProfile,
} from '@/lib/profiles'
import type { TerrainClassification } from '@/lib/backtest/classifyTerrain'

function terrain(
  type: TerrainClassification['type'],
  confidence: number
): TerrainClassification {
  return { type, confidence, elevation: 100 }
}

describe('deriveProfileFromTerrain', () => {
  it('maps mountain directly to mountain', () => {
    expect(deriveProfileFromTerrain(terrain('mountain', 0.9))).toBe('mountain')
  })

  it('maps coastal and island to coastal', () => {
    expect(deriveProfileFromTerrain(terrain('coastal', 0.85))).toBe('coastal')
    expect(deriveProfileFromTerrain(terrain('island', 0.9))).toBe('coastal')
  })

  it('maps urban directly to urban', () => {
    expect(deriveProfileFromTerrain(terrain('urban', 0.8))).toBe('urban')
  })

  it('maps flat and river_valley to plain', () => {
    expect(deriveProfileFromTerrain(terrain('flat', 0.7))).toBe('plain')
    expect(deriveProfileFromTerrain(terrain('river_valley', 0.7))).toBe('plain')
  })

  it('falls back to plain when confidence is below the 0.6 threshold', () => {
    expect(deriveProfileFromTerrain(terrain('mountain', 0.59))).toBe('plain')
    expect(deriveProfileFromTerrain(terrain('coastal', 0.5))).toBe('plain')
    expect(deriveProfileFromTerrain(terrain('urban', 0.4))).toBe('plain')
  })

  it('uses the threshold inclusive: 0.6 confidence keeps the derived profile', () => {
    expect(deriveProfileFromTerrain(terrain('mountain', 0.6))).toBe('mountain')
    expect(deriveProfileFromTerrain(terrain('coastal', 0.6))).toBe('coastal')
  })

  it('PROFILE_ORDER contains exactly the four profiles', () => {
    expect(PROFILE_ORDER).toEqual(['plain', 'coastal', 'mountain', 'urban'])
  })

  it('PROFILE_LABELS and PROFILE_LABELS_EN cover the same keys', () => {
    expect(Object.keys(PROFILE_LABELS).sort()).toEqual(Object.keys(PROFILE_LABELS_EN).sort())
    for (const p of PROFILE_ORDER) {
      expect(PROFILE_LABELS[p]).toBeTruthy()
      expect(PROFILE_LABELS_EN[p]).toBeTruthy()
    }
  })
})

describe('profilesAreEqual', () => {
  it('returns true for identical profiles', () => {
    expect(profilesAreEqual('coastal', 'coastal')).toBe(true)
  })

  it('returns false for different profiles', () => {
    expect(profilesAreEqual('coastal', 'mountain')).toBe(false)
  })

  it('returns true when both inputs are null', () => {
    expect(profilesAreEqual(null, null)).toBe(true)
  })

  it('returns false when one input is null', () => {
    expect(profilesAreEqual(null, 'plain')).toBe(false)
    expect(profilesAreEqual('plain', null)).toBe(false)
  })
})

describe('getProfileRecommendation (deprecated stub)', () => {
  it('returns an empty recommendation', () => {
    const rec = getProfileRecommendation()
    expect(rec.preferredModels).toEqual([])
    expect(rec.preferMarine).toBe(false)
    expect(rec.preferLongRange).toBe(false)
    expect(rec.descriptionEs).toBe('')
    expect(rec.descriptionEn).toBe('')
  })

  it('UsageProfile union is a subset of the original 6-element union', () => {
    const all: UsageProfile[] = ['plain', 'coastal', 'mountain', 'urban']
    expect(PROFILE_ORDER).toEqual(all)
  })
})
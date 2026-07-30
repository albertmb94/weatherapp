/**
 * B-NEW-29 (2026-07-30): regression guard for the
 * `saveLocalLocation` dedup logic. The previous implementation
 * always appended a new record, so the same city ended up in the
 * saved list two or three times when the user double-tapped Save.
 *
 * The dedup is the data-layer safety net behind the UI changes
 * (the Save button is now disabled when the current city is
 * already saved); these tests pin the data-layer behaviour so
 * future refactors don't silently re-introduce the bug.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getLocalSavedLocations,
  saveLocalLocation,
  deleteLocalLocation,
} from '../localStorageLocations'

describe('localStorageLocations — dedup (B-NEW-29)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves a brand new city and returns its record', () => {
    const loc = saveLocalLocation('Barcelona', 41.3851, 2.1734)
    expect(loc).toMatchObject({ name: 'Barcelona', latitude: 41.3851, longitude: 2.1734 })
    expect(typeof loc.id).toBe('number')
    expect(getLocalSavedLocations()).toHaveLength(1)
  })

  it('does NOT add a duplicate when the same name + ~50m coords already exist', () => {
    saveLocalLocation('Barcelona', 41.3851, 2.1734)
    const second = saveLocalLocation('Barcelona', 41.3851, 2.1734)
    // The dedup returns the existing record, so the list stays at 1
    // and the returned id matches the original.
    const all = getLocalSavedLocations()
    expect(all).toHaveLength(1)
    expect(second.id).toBe(all[0].id)
  })

  it('treats coords within 0.0005 deg (~50m) as the same place', () => {
    saveLocalLocation('Barcelona', 41.3851, 2.1734)
    // 0.0003 deg ≈ 33m latitude, well inside the 50m tolerance.
    const again = saveLocalLocation('Barcelona', 41.3851 + 0.0003, 2.1734 + 0.0003)
    expect(getLocalSavedLocations()).toHaveLength(1)
    expect(again.id).toBe(getLocalSavedLocations()[0].id)
  })

  it('treats coords just outside the tolerance as a NEW place', () => {
    saveLocalLocation('Barcelona', 41.3851, 2.1734)
    // 0.001 deg ≈ 110m latitude, outside the 50m tolerance, so
    // it should be saved as a separate record.
    saveLocalLocation('Barcelona', 41.3851 + 0.001, 2.1734)
    expect(getLocalSavedLocations()).toHaveLength(2)
  })

  it('matches names case-insensitively', () => {
    saveLocalLocation('Barcelona', 41.3851, 2.1734)
    const again = saveLocalLocation('barcelona', 41.3851, 2.1734)
    expect(getLocalSavedLocations()).toHaveLength(1)
    expect(again.id).toBe(getLocalSavedLocations()[0].id)
  })

  it('treats different names as different places even at the same coords', () => {
    // Some cities share a geocoder point (e.g. a town next to
    // a city). The name still differentiates them.
    saveLocalLocation('Barcelona', 41.3851, 2.1734)
    saveLocalLocation('L\'Hospitalet', 41.3851, 2.1734)
    expect(getLocalSavedLocations()).toHaveLength(2)
  })

  it('after a delete, re-saving the same city inserts a new record', () => {
    const first = saveLocalLocation('Barcelona', 41.3851, 2.1734)
    deleteLocalLocation(first.id)
    expect(getLocalSavedLocations()).toHaveLength(0)
    const second = saveLocalLocation('Barcelona', 41.3851, 2.1734)
    expect(getLocalSavedLocations()).toHaveLength(1)
    // The new record is a fresh row, not a revival of the old id.
    expect(second.id).not.toBe(first.id)
  })
})

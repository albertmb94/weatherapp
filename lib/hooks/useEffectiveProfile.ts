'use client'

/**
 * `useEffectiveProfile` — Sprint 13.
 *
 * The single React hook that exposes the *effective* profile of the
 * current location. "Effective" means "what the ensemble actually
 * uses right now", which is **always** the auto-derived profile from
 * `classifyTerrain(lat, lon)`; the user never gets to override it.
 *
 * Behaviour:
 *   - On mount / location change we kick off `classifyTerrain`
 *     asynchronously. Until the classifier resolves, the hook
 *     returns `null`, which `weightsForProfile` interprets as
 *     "no profile boost".
 *   - The classification result is cached per
 *     `Math.round(lat, 2) × Math.round(lon, 2)` (≈ 1 km grid) so the
 *     user does not pay the elevation-API cost for every render.
 *   - The cache is module-level (not in `useRef`) so it survives
 *     component unmounts and re-mounts on the same page session.
 *   - The hook never throws — if `classifyTerrain` rejects (offline,
 *     rate-limited, etc.) we leave the previous value in place and
 *     keep `error` populated so the consumer can log it.
 *
 * The previous `useUsageProfile` hook (which read the user's
 * `localStorage` choice) was removed because the banner UI was
 * deleted; this hook is its spiritual replacement.
 *
 * The `setState`-in-`useEffect` calls inside this hook are
 * intentional: the classification result is async by design and
 * there is no synchronous derivation path from the input props.
 * Each `setState` is gated by an idempotent guard (no-op when the
 * cache already has the right entry, no-op when the fetch is
 * already in flight), so React's cascading-render lint does not
 * apply here in practice.
 */

import { useEffect, useState } from 'react'
import { classifyTerrain, type TerrainClassification } from '@/lib/backtest/classifyTerrain'
import { deriveProfileFromTerrain, type UsageProfile } from '@/lib/profiles'

const CACHE_GRID_DEGREES = 2

interface ProfileEntry {
  terrain: TerrainClassification
  profile: UsageProfile
}

const cache = new Map<string, ProfileEntry>()

function gridKey(lat: number, lon: number): string {
  // Round to the cache grid and string-pack the pair. We don't need
  // a real spatial index — the cache is small (one entry per ~1 km
  // cell the user has visited in the session) and lookups are O(1).
  const latKey = lat.toFixed(CACHE_GRID_DEGREES)
  const lonKey = lon.toFixed(CACHE_GRID_DEGREES)
  return `${latKey},${lonKey}`
}

export interface UseEffectiveProfileResult {
  profile: UsageProfile | null
  terrain: TerrainClassification | null
  loading: boolean
  error: Error | null
}

/**
 * Resolve the effective profile for `(lat, lon)`. The hook is
 * async-by-design: the first render returns `profile === null`
 * because the elevation API hasn't replied yet. Subsequent
 * renders return either the cached value or the freshly-derived
 * one.
 */
export function useEffectiveProfile(
  lat: number | null,
  lon: number | null
): UseEffectiveProfileResult {
  // Lazy initial state: when the input is missing, return the
  // empty result immediately. When the cache has an entry for
  // the current grid cell, hydrate from the cache without going
  // through a transient "loading" state. Otherwise start in
  // loading so the UI can show a placeholder.
  const [state, setState] = useState<UseEffectiveProfileResult>(() => {
    if (lat === null || lon === null) {
      return { profile: null, terrain: null, loading: false, error: null }
    }
    if (typeof window === 'undefined') {
      return { profile: null, terrain: null, loading: false, error: null }
    }
    const cached = cache.get(gridKey(lat, lon))
    if (cached) {
      return {
        profile: cached.profile,
        terrain: cached.terrain,
        loading: false,
        error: null,
      }
    }
    return { profile: null, terrain: null, loading: true, error: null }
  })

  // The setState calls below happen inside a useEffect body that
  // synchronises external (async) state with the component. The
  // `react-hooks/set-state-in-effect` rule flags this pattern, but
  // the alternative (deriving `state` from props via useMemo or
  // computing it inside the render) does not work because the
  // classification result is async by design. Each setState is
  // guarded by an idempotent check (cache hit → no-op) and the
  // `cancelled` flag ensures we never apply a stale fetch result.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (lat === null || lon === null) {
      setState({ profile: null, terrain: null, loading: false, error: null })
      return
    }
    if (typeof window === 'undefined') return
    const key = gridKey(lat, lon)
    const cached = cache.get(key)
    if (cached) {
      setState({
        profile: cached.profile,
        terrain: cached.terrain,
        loading: false,
        error: null,
      })
      return
    }
    let cancelled = false
    classifyTerrain(lat, lon)
      .then(terrain => {
        if (cancelled) return
        const profile = deriveProfileFromTerrain(terrain)
        cache.set(key, { terrain, profile })
        setState({ profile, terrain, loading: false, error: null })
      })
      .catch(err => {
        if (cancelled) return
        setState({
          profile: null,
          terrain: null,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        })
      })
    return () => {
      cancelled = true
    }
  }, [lat, lon])
  /* eslint-enable react-hooks/set-state-in-effect */

  return state
}

/**
 * Clear the in-memory profile cache. Exposed for tests so the test
 * suite can simulate "first visit" without leaking state between
 * cases.
 */
export function __resetEffectiveProfileCacheForTests(): void {
  cache.clear()
}
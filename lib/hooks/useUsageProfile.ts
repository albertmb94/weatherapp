'use client'

import { useSyncExternalStore } from 'react'
import { PROFILE_ORDER, type UsageProfile } from '@/components/ProfilePicker'

const KEY = 'weather-profile'
const DEFAULT: UsageProfile = 'plain'

/**
 * Subscribe to a localStorage value with `useSyncExternalStore` so the
 * SSR pass and the first client render agree byte-for-byte. On the
 * server we return the documented default; on the client the hook
 * reads the localStorage entry on mount (via the subscription) and
 * returns the persisted value thereafter.
 *
 * No `useEffect`/`useState` involved → React 19 strict-mode clean.
 */
function subscribeProfile(notify: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('storage', notify)
  // Fire once on mount so the localStorage value beats the SSR default.
  notify()
  return () => window.removeEventListener('storage', notify)
}

function readProfileFromStorage(): UsageProfile {
  if (typeof window === 'undefined') return DEFAULT
  const stored = window.localStorage.getItem(KEY)
  if (stored && (PROFILE_ORDER as string[]).includes(stored)) {
    return stored as UsageProfile
  }
  return DEFAULT
}

function serverProfileSnapshot(): UsageProfile {
  return DEFAULT
}

export function useUsageProfile(): [UsageProfile, (next: UsageProfile) => void] {
  const profile = useSyncExternalStore(
    subscribeProfile,
    readProfileFromStorage,
    serverProfileSnapshot,
  )
  function change(next: UsageProfile) {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(KEY, next)
    }
    // Dispatch a synthetic storage event so any other open tab also
    // picks up the change without polling.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    }
  }
  return [profile, change]
}

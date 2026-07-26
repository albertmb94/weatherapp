'use client'

import { useEffect, useState } from 'react'
import { PROFILE_ORDER, type UsageProfile } from '@/components/ProfilePicker'

const KEY = 'weather-profile'
const DEFAULT: UsageProfile = 'plain'

/**
 * Persist the user-selected usage profile in localStorage. Server
 * renders return the default value so the SSR and the first client
 * render agree (otherwise we'd swap labels during hydration).
 */
export function useUsageProfile(): [UsageProfile, (next: UsageProfile) => void] {
  const [profile, setProfile] = useState<UsageProfile>(DEFAULT)
  // Hydrate after mount so that the SSR render and the initial client
  // render stay identical.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(KEY)
    if (stored && (PROFILE_ORDER as string[]).includes(stored)) {
      setProfile(stored as UsageProfile)
    }
  }, [])
  function change(next: UsageProfile) {
    setProfile(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(KEY, next)
    }
  }
  return [profile, change]
}

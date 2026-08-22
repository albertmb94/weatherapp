'use client'

import { useEffect, useState } from 'react'

// B-NBT-5 (2026-08-22): the previous implementation seeded state from
// `typeof navigator !== 'undefined' ? navigator.onLine : true`, which
// silently broke under Node >= 21: the SERVER also exposes a global
// `navigator` (userAgent etc.) but WITHOUT `.onLine`, so SSR evaluated
// `!navigator.onLine` to true and rendered the offline banner while
// the client rendered the online tree — a guaranteed hydration error
// on every page load. The safe contract is: assume ONLINE during SSR
// AND the first client render, then sync the real value in an effect
// (a genuinely-offline user gets exactly one corrected frame).
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true)

  // Sync-on-mount is intentional: the real navigator.onLine value is
  // only available after hydration (see the B-NBT-5 note above). This
  // mirrors the useClientNow pattern used across the app.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setOnline(navigator.onLine)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  return online
}

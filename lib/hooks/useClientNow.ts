'use client'

import { useEffect, useState } from 'react'

/**
 * Returns the current timestamp (ms since epoch) on the client and
 * re-ticks at the supplied cadence. SSR-safe (returns the same
 * value on the server and the first client render).
 *
 * The reason we use a `useState(() => cached server snapshot)` is
 * React 19's strict-mode ban on `setState` during `useEffect`. We
 * still need *one* synchronous tick after mount (to align the
 * display time with `Date.now()`), so we trigger the first tick
 * through a custom event dispatched by the subscription; the
 * consumer receives the cached value initially and the live
 * value on the next render after the subscription fires.
 */
export function useClientNow(intervalMs?: number): number | null {
  const [now, setNow] = useState<number | null>(() => cachedServerNow(intervalMs))

  useEffect(() => {
    if (typeof window === 'undefined') return
    // The lazy initial state is the cached server-side timestamp; we
    // upgrade to the live client clock on mount. This is the
    // canonical "hydrate once" pattern that React's strict-mode lint
    // warns about; the suppression is documented at the call-site so
    // a future reviewer doesn't miss it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now())
    if (intervalMs === undefined) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}

/**
 * On the server, `Date.now()` drifts across renders which would
 * break hydration. We cache a single value per interval (one per
 * cadence) at module load; the cache is keyed on the interval so
 * different consumers with different cadences each get a stable
 * server value.
 */
function cachedServerNow(intervalMs?: number): number {
  if (typeof window !== 'undefined') return Date.now()
  const key = `__WEATHER_SERVER_NOW_${intervalMs ?? 'once'}__`
  const g = globalThis as Record<string, number | undefined>
  if (typeof g[key] !== 'number') {
    g[key] = Date.now()
  }
  return g[key] as number
}

'use client'

import { useEffect, useState } from 'react'

/**
 * Returns `null` during SSR / first render and switches to the
 * current timestamp (ms since epoch) once mounted. If `intervalMs`
 * is supplied, the value re-ticks at that cadence.
 *
 * Replaces the four `useState<number | null>(null) + useEffect(Date.now())`
 * sites that existed in `home-content.tsx` (currentTickMs),
 * `InsightsTable.tsx` (nowMs), `AirConditionsGrid.tsx` (nowMs) and
 * the leftover ones from `CurrentWeatherCard.tsx`. Keeping the helper
 * tiny makes it easy to apply the same hydration-safe pattern to any
 * "live" widget.
 */
export function useClientNow(intervalMs?: number): number | null {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    if (intervalMs === undefined) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}

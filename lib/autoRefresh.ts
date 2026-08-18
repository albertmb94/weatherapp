/**
 * Throttle predicate for the per-location auto-refresh.
 *
 * `app/home-content.tsx` polls `data.fetchedAt > 2h` every minute
 * (`useClientNow(60_000)`). When the predicate is true we invalidate
 * the React Query forecast so a fresh `/api/forecast` lands. The
 * predicate keeps firing as long as the data is old, but we don't
 * want a refetch every minute — a cache hit returning the same
 * `fetchedAt`, a network failure, or a 5-minute tick could send
 * the loop spinning. The throttle ensures we never invalidate
 * more than once per minute from the auto-refresh path. The
 * `isFetching` short-circuit lets the in-flight request keep
 * running without overlapping with the next one.
 */
export function shouldAutoRefresh(
  args: {
    /** Age of the current cached forecast in ms. `null` when no
     *  data has arrived yet. */
    forecastAgeMs: number | null
    /** Server-side refresh window. The cached forecast is
     *  considered stale at exactly this age. */
    refreshWindowMs: number
    /** True when React Query is already fetching (initial load,
     *  pull-to-refresh, manual refresh, etc.). We let the
     *  in-flight fetch complete instead of invalidating again. */
    isFetching: boolean
    /** Wall-clock time of the last `invalidateQueries` call. The
     *  first call always passes (0). */
    lastRefreshAt: number
    /** Current wall-clock time (the same `useClientNow(60_000)`
     *  value the orchestrator ticks every minute). */
    now: number
    /** Visibility of the tab. Hidden tabs are skipped (the user
     *  won't see the result, and refetchOnWindowFocus handles
     *  the return). */
    isVisible: boolean
    /** Minimum gap between two auto-refreshes, in ms. The current
     *  orchestrator uses 60s. */
    throttleMs: number
  }
): boolean {
  const { forecastAgeMs, refreshWindowMs, isFetching, lastRefreshAt, now, isVisible, throttleMs } = args
  if (forecastAgeMs === null) return false
  if (forecastAgeMs < refreshWindowMs) return false
  if (isFetching) return false
  if (!isVisible) return false
  if (now - lastRefreshAt < throttleMs) return false
  return true
}

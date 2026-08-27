/**
 * Integration test for the per-location auto-refresh flow inside
 * `app/home-content.tsx`. The pure predicate (`shouldAutoRefresh`)
 * is covered in `autoRefresh.test.ts`; this file focuses on the
 * user-facing behaviour the user reported on 2026-08-18: when a
 * user enters the app or searches for a city and the cached
 * forecast for that location is older than 2h, the query must
 * auto-invalidate and refetch — without the user touching anything.
 *
 * We don't render the full `home-content.tsx` component (it drags in
 * Leaflet, IndexedDB, geolocation, etc.). Instead we test the
 * orchestrator effect in isolation by mounting a tiny harness that
 * imports the same `useQuery` config + `useEffect` shape and verifies
 * the right `invalidateQueries` call lands.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { shouldAutoRefresh } from '@/lib/autoRefresh'
import { REFRESH_WINDOW_MS } from '@/lib/refreshWindow'

interface ForecastResult {
  fetchedAt: number
  // other fields would be here; not relevant to this test.
  temperature?: { current: number | null }
}

const AUTO_REFRESH_THROTTLE_MS = 60_000
const TICK_MS = 60_000

/**
 * Minimal harness that mirrors the auto-refresh effect in
 * `app/home-content.tsx`:
 *  - tracks `forecastAgeMs` from a mock `fetchedAt`
 *  - ticks a fake clock every TICK_MS (controlled via `useFakeTimers`)
 *  - calls `invalidateQueries` when `shouldAutoRefresh` returns true
 *  - records every invalidation so the test can assert on them
 */
function useHarness(mockFetchedAt: number, fetchFn: () => Promise<ForecastResult>) {
  const queryClient = useQueryClient()
  const [forecastAgeMs, setForecastAgeMs] = useState<number | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const lastAutoRefreshAtRef = useRef(0)
  const invalidations = useRef<unknown[]>([])

  // Mock the forecast query so `data` lands with `fetchedAt = mockFetchedAt`.
  const { data, isFetching: rqIsFetching } = useQuery<ForecastResult>({
    queryKey: ['forecast', 0, 0, 168, false],
    queryFn: fetchFn,
  })

  useEffect(() => { setIsFetching(rqIsFetching) }, [rqIsFetching])

  // Replicate the orchestrator's tick — same 60s cadence as
  // `useClientNow(60_000)` in production.
  const [currentTickMs, setCurrentTickMs] = useState<number | null>(null)
  useEffect(() => {
    const id = setInterval(() => setCurrentTickMs(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (data?.fetchedAt && currentTickMs) {
      setForecastAgeMs(Math.max(0, currentTickMs - data.fetchedAt))
    } else if (!data) {
      setForecastAgeMs(null)
    }
  }, [data, currentTickMs])

  // The effect under test.
  useEffect(() => {
    if (forecastAgeMs === null) return
    if (!shouldAutoRefresh({
      forecastAgeMs,
      refreshWindowMs: REFRESH_WINDOW_MS,
      isFetching,
      lastRefreshAt: lastAutoRefreshAtRef.current,
      now: currentTickMs ?? Date.now(),
      isVisible: true,
      throttleMs: AUTO_REFRESH_THROTTLE_MS,
    })) {
      return
    }
    lastAutoRefreshAtRef.current = currentTickMs ?? Date.now()
    queryClient.invalidateQueries({ queryKey: ['forecast', 0, 0, 168, false] })
    invalidations.current.push({ at: currentTickMs, age: forecastAgeMs })
  }, [forecastAgeMs, isFetching, currentTickMs, queryClient])

  return { invalidations: invalidations.current, forecastAgeMs, data }
}

function makeHarness(mockFetchedAt: number, fetchFn: () => Promise<ForecastResult>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Harness({ exposed }: { exposed: (h: ReturnType<typeof useHarness>) => void }) {
    const h = useHarness(mockFetchedAt, fetchFn)
    exposed(h)
    return null
  }
  let captured: ReturnType<typeof useHarness> | null = null
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Harness exposed={h => { captured = h }} />
    </QueryClientProvider>,
  )
  return { ...utils, getHarness: () => captured as ReturnType<typeof useHarness> }
}

describe('per-location auto-refresh integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-18T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does NOT invalidate when the cached forecast is fresh (< 2h)', async () => {
    const fetchedAt = Date.now() // 0 ms ago
    const fetchSpy = vi.fn().mockResolvedValue({ fetchedAt })
    const { getHarness } = makeHarness(fetchedAt, fetchSpy)
    // Advance one tick + a few minutes — still well under 2h.
    await act(async () => {
      vi.advanceTimersByTime(60_000 * 5)
    })
    const harness = getHarness()
    expect(harness.invalidations.length).toBe(0)
    expect(harness.forecastAgeMs).toBe(5 * 60_000)
    // The mock fetch hasn't been called again — auto-refresh did NOT
    // invalidate the query.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('DOES invalidate when the cached forecast is older than 2h (entry scenario)', async () => {
    const fetchedAt = Date.now() - (3 * 60 * 60 * 1000) // 3 hours ago
    const fetchSpy = vi.fn().mockResolvedValue({ fetchedAt })
    const { getHarness } = makeHarness(fetchedAt, fetchSpy)
    // Advance the tick clock once — the effect should fire now that
    // forecastAgeMs >= REFRESH_WINDOW_MS.
    await act(async () => {
      vi.advanceTimersByTime(TICK_MS)
    })
    const harness = getHarness()
    expect(harness.forecastAgeMs).toBeGreaterThanOrEqual(REFRESH_WINDOW_MS)
    expect(harness.invalidations.length).toBeGreaterThan(0)
    // React Query refetches on invalidate → mock fetch is called again.
    await act(async () => {
      // Flush the refetch + the next tick so any extra invalidations
      // get a chance to land.
      vi.advanceTimersByTime(2000)
      vi.advanceTimersByTime(TICK_MS * 2)
    })
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('throttles to one invalidation per AUTO_REFRESH_THROTTLE_MS window', async () => {
    const fetchedAt = Date.now() - (3 * 60 * 60 * 1000)
    const fetchSpy = vi.fn().mockResolvedValue({ fetchedAt })
    const { getHarness } = makeHarness(fetchedAt, fetchSpy)
    // Advance many ticks in quick succession — should only invalidate
    // once within the throttle window.
    await act(async () => {
      vi.advanceTimersByTime(TICK_MS * 10)
      vi.advanceTimersByTime(2000) // let the refetch settle
    })
    const harness = getHarness()
    // First invalidation at tick 0, the rest throttled (each tick
    // is 60s apart and the throttle is also 60s).
    expect(harness.invalidations.length).toBe(1)
  })

  it('fires again after the throttle window elapses', async () => {
    const fetchedAt = Date.now() - (3 * 60 * 60 * 1000)
    const fetchSpy = vi.fn().mockResolvedValue({ fetchedAt })
    const { getHarness } = makeHarness(fetchedAt, fetchSpy)
    // First invalidation.
    await act(async () => {
      vi.advanceTimersByTime(TICK_MS)
      vi.advanceTimersByTime(2000)
    })
    let harness = getHarness()
    expect(harness.invalidations.length).toBe(1)
    // Advance well past the throttle window (60s) and another tick.
    await act(async () => {
      vi.advanceTimersByTime(AUTO_REFRESH_THROTTLE_MS * 2)
      vi.advanceTimersByTime(TICK_MS)
      vi.advanceTimersByTime(2000)
    })
    harness = getHarness()
    expect(harness.invalidations.length).toBeGreaterThanOrEqual(2)
  })
})

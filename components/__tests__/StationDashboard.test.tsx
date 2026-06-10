import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { LocaleProvider } from '@/lib/LocaleContext'

// Leaflet can't initialise in jsdom, so stub the map with a no-op component.
vi.mock('@/components/StationMap', () => ({
  default: () => null,
}))

import StationDashboard from '@/components/StationDashboard'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>{children}</LocaleProvider>
      </QueryClientProvider>
    )
  }
  return Wrapper
}

function mockFailingFetch(detail = 'fail') {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: 'Server error', detail }),
  })
}

describe('StationDashboard retry behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the loading spinner during the initial fetch', () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})))

    render(<StationDashboard />, { wrapper: createWrapper() })

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('hides the error and keeps showing loading while a retry is in flight', async () => {
    vi.stubGlobal('fetch', mockFailingFetch())

    render(<StationDashboard />, { wrapper: createWrapper() })

    // Flush the initial failure: isError becomes true, but a retry is
    // immediately scheduled so isFetching is also true.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('Error loading stations')).not.toBeInTheDocument()
  })

  it('retries up to 5 times with a 1s delay before showing the error', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error', detail: 'fail' }),
      })
    }))

    render(<StationDashboard />, { wrapper: createWrapper() })

    // 5 retries × 1000ms = 5000ms, plus a buffer for the final tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })

    expect(callCount).toBe(6) // 1 initial + 5 retries
    expect(screen.getByText('Error loading stations')).toBeInTheDocument()
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
  })

  it('renders the error block at the bottom of the dashboard (after the cards grid)', async () => {
    vi.stubGlobal('fetch', mockFailingFetch())

    render(<StationDashboard />, { wrapper: createWrapper() })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })

    const errorBlock = screen.getByRole('alert')
    const dashboard = errorBlock.parentElement!
    // The error block should be the last child of the dashboard.
    expect(dashboard.lastElementChild).toBe(errorBlock)
  })
})

describe('StationDashboard AEMET dedup (A2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('A2: keeps the most recent observation per idema, not the first', async () => {
    // AEMET returns ~24h of observations per idema, sorted by fint ASC.
    // Before A2 fix, the first (oldest) was kept. We now keep the latest.
    // Coordinates are inside the default BCN region.
    const stationsResponse = {
      stations: [
        { idema: 'A001', ubi: 'Station 1', lat: 41.4, lon: 2.15, fint: '2026-06-09T10:00:00', ta: 10 },
        { idema: 'A001', ubi: 'Station 1', lat: 41.4, lon: 2.15, fint: '2026-06-10T10:00:00', ta: 25 },
        { idema: 'A001', ubi: 'Station 1', lat: 41.4, lon: 2.15, fint: '2026-06-09T20:00:00', ta: 18 },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(stationsResponse),
    }))

    render(<StationDashboard />, { wrapper: createWrapper() })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // After A2 fix, the latest observation (2026-06-10) should win.
    // StationCard displays "25.0°" (the current temperature from the
    // most recent fint) rather than "10.0°" (the oldest).
    const allCards = screen.getAllByText(/25\.0°/)
    expect(allCards.length).toBeGreaterThan(0)
  })
})

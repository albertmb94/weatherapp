import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { LocaleProvider } from '@/lib/LocaleContext'

// Leaflet can't initialise in jsdom, so stub the map with a forwarder
// that records the props it receives so the tests can assert the
// `position` prop is threaded through.
const stationMapCalls: Array<{ stations?: unknown[]; position?: [number, number] | null }> = []
vi.mock('@/components/StationMap', () => ({
  default: (props: { stations?: unknown[]; position?: [number, number] | null }) => {
    stationMapCalls.push({
      stations: props.stations as unknown[] | undefined,
      position: props.position ?? null,
    })
    return null
  },
}))

import StationDashboard from '@/components/StationDashboard'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {/* Idioma EXPLICITO: estos tests esperan cadenas en ingles y
            antes lo conseguian por accidente, porque el proveedor leia
            navigator.language (en-US en jsdom). */}
        <LocaleProvider locale="en">{children}</LocaleProvider>
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
    stationMapCalls.length = 0
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

      // AEMET (primary) retries 5×  -> 6 attempts. Meteoclimatic and Meteocat
      // are supplementary and fail fast on transient errors (2 retries each)
      // -> 3 attempts each. 6 + 3 + 3 = 12 total calls.
      expect(callCount).toBe(12)
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

  describe('S5: position-driven mode', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('fetches Meteoclimatic by coordinates when a position is provided', async () => {
      const calls: string[] = []
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        calls.push(url)
        if (typeof url === 'string' && url.startsWith('/api/aemet')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ stations: [] }) })
        }
        if (typeof url === 'string' && url.includes('meteoclimatic') && url.includes('lat=')) {
          return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({ stations: [], prefix: 'ESCAT08' }),
          })
        }
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
      }))

      render(<StationDashboard position={[41.4, 2.15]} placeName="Barcelona" />, { wrapper: createWrapper() })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(calls.some(u => u.includes('meteoclimatic') && u.includes('lat=41.4') && u.includes('lon=2.2'))).toBe(true)
      expect(calls.some(u => u.includes('meteoclimatic') && u.includes('station='))).toBe(false)
    })

    // B-NEW-38 (2026-08-18): the Estaciones map used to mount with a
    // hard-coded Madrid fallback centre and only fit-to-bounds once
    // the first station fetch landed. On a deep link or on the first
    // entry after navigating to a city, the markers loaded at the
    // user's location but the view stayed on Madrid until the user
    // nudged the radius selector (which triggered a fresh fetch and
    // finally re-keyed `AutoFitBounds`). Threading the URL coords
    // through to the map's `center` mounts the map already centred
    // on the right spot, so the first paint matches the chip.
    it('forwards the URL position to StationMap so the map mounts on the user location, not Madrid', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ stations: [] }),
      }))

      render(<StationDashboard position={[40.42, -3.7]} placeName="Madrid" />, { wrapper: createWrapper() })

      // The StationMap mock records every render's props so we can
      // confirm the URL coords reach the map even before the first
      // query resolves.
      const lastCall = stationMapCalls[stationMapCalls.length - 1]
      expect(lastCall?.position).toEqual([40.42, -3.7])
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

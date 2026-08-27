import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SavedLocations from '../SavedLocations'
import { LocaleProvider } from '@/lib/LocaleContext'

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Provider = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <LocaleProvider locale="es">{children}</LocaleProvider>
    </QueryClientProvider>
  )
  return { qc, Provider }
}

describe('SavedLocations', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    localStorage.removeItem('weather-saved-locations')
  })

  it('renders nothing when localStorage is empty', () => {
    // Default jsdom localStorage has no entries.
    const { Provider } = makeWrapper()
    const { container } = render(
      <Provider>
        <SavedLocations onSelect={() => {}} />
      </Provider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('fires onSelect when the user clicks a saved city', () => {
    // Pre-populate localStorage with one entry.
    localStorage.setItem(
      'weather-saved-locations',
      JSON.stringify([
        { id: 1, name: 'Badalona', latitude: 41.45, longitude: 2.2475 },
      ]),
    )
    const onSelect = vi.fn()
    const { Provider } = makeWrapper()
    render(
      <Provider>
        <SavedLocations onSelect={onSelect} />
      </Provider>,
    )
    act(() => {
      fireEvent.click(screen.getByText('Badalona'))
    })
    expect(onSelect).toHaveBeenCalledWith('Badalona', 41.45, 2.2475)
  })

  // B-NEW-29 (2026-07-30): when a new chip appears in the
  // saved-locations strip, we briefly highlight it so the
  // user has a visual anchor for "the save just happened".
  // The previous version only showed a toast, which disappeared
  // too fast to give the user any visual feedback. The
  // highlight lives 1.6s; the test pins the "highlighted on
  // first render after the new id shows up" behaviour.
  it('highlights a newly added chip via the data-highlighted attribute', async () => {
    // Start with one city in localStorage so the initial
    // QueryClient data has id=1.
    localStorage.setItem(
      'weather-saved-locations',
      JSON.stringify([
        { id: 1, name: 'Badalona', latitude: 41.45, longitude: 2.2475 },
      ]),
    )
    const { qc, Provider } = makeWrapper()
    render(
      <Provider>
        <SavedLocations onSelect={() => {}} />
      </Provider>,
    )
    // On first mount the chip is NOT highlighted (it's not new,
    // it was already in the list when the component mounted).
    expect(screen.getByTestId('saved-locations-chip').getAttribute('data-highlighted')).toBe('false')

    // Simulate the user saving a new city: a sibling code path
    // (the mobile-menu Save button or the CitiesList big
    // button) calls `queryClient.setQueryData(['saved-locations'], …)`
    // to add the new id. We do the same here so the test stays
    // at the component level (we don't actually have to fire
    // the save mutation).
    act(() => {
      qc.setQueryData(['saved-locations'], [
        { id: 1, name: 'Badalona', latitude: 41.45, longitude: 2.2475 },
        { id: 2, name: 'Mataró', latitude: 41.54, longitude: 2.4446 },
      ])
    })

    // The new chip (id=2) is the one that should be highlighted.
    // We use `waitFor` because the QueryClient update triggers a
    // React re-render that doesn't complete inside the `act`
    // callback (react-query batches notifications).
    await waitFor(() => {
      const chips = screen.getAllByTestId('saved-locations-chip')
      expect(chips).toHaveLength(2)
    })
    const chips = screen.getAllByTestId('saved-locations-chip')
    const badalona = chips.find(c => c.textContent?.includes('Badalona'))!
    const mataro = chips.find(c => c.textContent?.includes('Mataró'))!
    expect(badalona.getAttribute('data-highlighted')).toBe('false')
    expect(mataro.getAttribute('data-highlighted')).toBe('true')
  })
})

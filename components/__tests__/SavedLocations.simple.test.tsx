import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SavedLocations from '../SavedLocations'
import { LocaleProvider } from '@/lib/LocaleContext'

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <LocaleProvider initialLocale="es">{children}</LocaleProvider>
    </QueryClientProvider>
  )
}

describe('SavedLocations', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders nothing when localStorage is empty', () => {
    // Default jsdom localStorage has no entries.
    const Provider = wrapper()
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
    const Provider = wrapper()
    render(
      <Provider>
        <SavedLocations onSelect={onSelect} />
      </Provider>,
    )
    act(() => {
      fireEvent.click(screen.getByText('Badalona'))
    })
    expect(onSelect).toHaveBeenCalledWith('Badalona', 41.45, 2.2475)
    // Cleanup so the next test starts from a clean slate.
    localStorage.removeItem('weather-saved-locations')
  })
})

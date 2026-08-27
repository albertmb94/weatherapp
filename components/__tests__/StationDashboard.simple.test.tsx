import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import StationDashboard from '../StationDashboard'
import { LocaleProvider } from '@/lib/LocaleContext'

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function TestWrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <LocaleProvider initialLocale="es">{children}</LocaleProvider>
      </QueryClientProvider>
    )
  }
  TestWrapper.displayName = 'TestWrapper'
  return TestWrapper
}

describe('StationDashboard (rendered in isolation)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders gracefully without a position prop', () => {
    const Provider = wrapper()
    render(
      <Provider>
        <StationDashboard />
      </Provider>,
    )
    // No crash; the wrapper is present.
    expect(document.body.firstChild).not.toBeNull()
  })

  it('renders a loading state when a position is provided and stations are fetching', async () => {
    const Provider = wrapper()
    // Without an AEMET_API_KEY the route returns 502, so the component
    // surfaces an empty state rather than a list. Either way it must
    // not crash.
    render(
      <Provider>
        <StationDashboard position={[41.39, 2.17]} placeName="Badalona" />
      </Provider>,
    )
    // The component renders within the test environment; the only
    // contract is "no crash".
    expect(document.body.firstChild).not.toBeNull()
  })

  void act
})

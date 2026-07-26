import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import FriendlyHome from '../FriendlyHome'
import { LocaleProvider } from '@/lib/LocaleContext'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MODELS } from '@/lib/models'

function wrapper(locale: 'es' | 'en') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Inner({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </QueryClientProvider>
    )
  }
  return Inner
}

const time = Array.from({ length: 6 }, (_, i) =>
  new Date(Date.UTC(2026, 6, 1, i, 0, 0)),
)
const series = Object.fromEntries(
  ['ecmwf_ifs'].map(id => [id, { temperature: [10, 11, 12, 13, 14, 15] }]),
)

describe('FriendlyHome', () => {
  it('renders the big "Tiempo actual" header in Spanish', () => {
    const Provider = wrapper('es')
    render(
      <Provider>
        <FriendlyHome
          city="Badalona"
          cityIsLoading={false}
          models={MODELS}
          activeIds={['ecmwf_ifs']}
          time={time}
          series={series}
          nowIndex={0}
          selectedHourOffset={0}
          utcOffsetSeconds={7200}
        />
      </Provider>,
    )
    // The Spanish aria-label is "Tiempo actual".
    expect(
      screen.getAllByLabelText(/Tiempo actual/i).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('does not crash when stations is empty and shows the nowcast label only when a delta is given', () => {
    const Provider = wrapper('es')
    render(
      <Provider>
        <FriendlyHome
          city="Badalona"
          cityIsLoading={false}
          models={MODELS}
          activeIds={['ecmwf_ifs']}
          time={time}
          series={series}
          nowIndex={0}
          selectedHourOffset={1}
          utcOffsetSeconds={7200}
          stations={[]}
        />
      </Provider>,
    )
    // No nowcast delta label should appear in the DOM when there's no
    // station within range.
    const deltas = document.querySelectorAll('[title*="vs ensemble"], [title=""]')
    expect(deltas.length).toBe(0)
  })
})

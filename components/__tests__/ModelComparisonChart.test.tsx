import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MODELS } from '@/lib/models'
import ModelComparisonChart from '../ModelComparisonChart'
import { LocaleProvider } from '@/lib/LocaleContext'

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Inner({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <LocaleProvider initialLocale="en">{children}</LocaleProvider>
      </QueryClientProvider>
    )
  }
  return Inner
}

const times = Array.from({ length: 6 }, (_, i) =>
  new Date(Date.UTC(2026, 6, 1, i, 0, 0)),
)
const series = {
  ecmwf_ifs: { temperature: [10, 11, 12, 13, 14, 15] },
  icon_global: { temperature: [12, 13, 14, 15, 16, 17] },
}

describe('ModelComparisonChart', () => {
  it('renders the PNG export button when at least one model is active', () => {
    const Provider = wrapper()
    render(
      <Provider>
        <ModelComparisonChart
          models={MODELS}
          activeModelIds={['ecmwf_ifs', 'icon_global']}
          metric="temperature"
          times={times}
          series={series}
          onHourHover={() => {}}
          hoveredHour={0}
          maxHours={6}
        />
      </Provider>,
    )
    expect(screen.getByTitle(/Export chart as PNG/i)).toBeInTheDocument()
  })

  it('respects the no-model-empty state (no PNG export, helpful message)', () => {
    const Provider = wrapper()
    render(
      <Provider>
        <ModelComparisonChart
          models={MODELS}
          activeModelIds={[]}
          metric="temperature"
          times={times}
          series={series}
          onHourHover={() => {}}
          hoveredHour={0}
          maxHours={6}
          ensembleMode="models"
        />
      </Provider>,
    )
    // No models + Models mode → the chart renders a friendly empty
    // state with the "No models selected" hint and no PNG button.
    expect(screen.getByText(/No models selected/i)).toBeInTheDocument()
    expect(screen.queryByTitle(/Export chart as PNG/i)).not.toBeInTheDocument()
  })
})

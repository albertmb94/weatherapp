import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DailySummary from '@/components/DailySummary'
import { LocaleProvider } from '@/lib/LocaleContext'

// Minimal weather model so we can render the component with one model.
const MODELS = [
  {
    id: 'gfs_global',
    label: 'GFS',
    color: '#fff',
    maxHours: 384,
    weight: 100,
    type: 'deterministic' as const,
    region: 'global' as const,
  },
]

// Build an array of "UTC-fake-local" Date objects (see lib/dateUtils.ts):
// the i-th entry has getUTCHours() === (startUtcHour + i) mod 24.
function fakeLocalTimes(startUtcHour: number, count: number): Date[] {
  const out: Date[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(2026, 5, 10, startUtcHour, 0, 0) + i * 3600_000)
    out.push(d)
  }
  return out
}

// Build a flat series filled with constant temperatures so the card has
// something to render.
function flatSeries(values: number[], count: number) {
  return {
    gfs_global: {
      temperature: Array.from({ length: count }, () => values[0]),
      precipitation: Array.from({ length: count }, () => 0),
      wind_gusts: Array.from({ length: count }, () => 0),
      cloud_cover: Array.from({ length: count }, () => 50),
    },
  }
}

function wrap(node: React.ReactNode) {
  return <LocaleProvider>{node}</LocaleProvider>
}

describe('DailySummary — noonIndex (single offset applied)', () => {
  // Times are UTC-fake-local (see lib/dateUtils.ts): getUTCHours() === 12
  // already means 12:00 at the LOCATION, so DailySummary must not apply
  // `utcOffsetSeconds` a second time.
  it('selects getUTCHours()===12 regardless of the offset (UTC)', async () => {
    const onSelectHour = vi.fn()
    const user = userEvent.setup()
    const count = 30
    render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={['gfs_global']}
        times={fakeLocalTimes(0, count)}
        series={flatSeries([20], count)}
        selectedHour={0}
        onSelectHour={onSelectHour}
        maxHours={count}
        utcOffsetSeconds={0}
      />
    ))
    await user.click(screen.getAllByRole('button')[0])
    expect(onSelectHour).toHaveBeenCalledWith(12)
  })

  it('selects 12:00 in CEST (offset=+2) — not 10:00', async () => {
    const onSelectHour = vi.fn()
    const user = userEvent.setup()
    const count = 30
    render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={['gfs_global']}
        times={fakeLocalTimes(0, count)}
        series={flatSeries([20], count)}
        selectedHour={0}
        onSelectHour={onSelectHour}
        maxHours={count}
        utcOffsetSeconds={2 * 3600}
      />
    ))
    await user.click(screen.getAllByRole('button')[0])
    expect(onSelectHour).toHaveBeenCalledWith(12)
  })

  it('selects 12:00 in UTC-5 (offset=-18000) — not 17:00', async () => {
    const onSelectHour = vi.fn()
    const user = userEvent.setup()
    const count = 30
    render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={['gfs_global']}
        times={fakeLocalTimes(0, count)}
        series={flatSeries([20], count)}
        selectedHour={0}
        onSelectHour={onSelectHour}
        maxHours={count}
        utcOffsetSeconds={-5 * 3600}
      />
    ))
    await user.click(screen.getAllByRole('button')[0])
    expect(onSelectHour).toHaveBeenCalledWith(12)
  })

  it('always selects the 12:00 slot of the day regardless of offset', async () => {
    const onSelectHour = vi.fn()
    const user = userEvent.setup()
    const count = 30
    render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={['gfs_global']}
        times={fakeLocalTimes(0, count)}
        series={flatSeries([20], count)}
        selectedHour={0}
        onSelectHour={onSelectHour}
        maxHours={count}
        utcOffsetSeconds={12 * 3600}
      />
    ))
    await user.click(screen.getAllByRole('button')[0])
    expect(onSelectHour).toHaveBeenCalledWith(12)
  })
})
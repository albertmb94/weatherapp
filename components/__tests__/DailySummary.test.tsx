import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DailySummary from '@/components/DailySummary'
import { LocaleProvider } from '@/lib/LocaleContext'

// Minimal weather model so we can render the component with one model.
const MODELS = [
  { id: 'gfs_global', label: 'GFS', color: '#fff', maxHours: 384, weight: 100 },
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

describe('DailySummary — noonIndex (B-NEW-2)', () => {
  it('UTC location (offset=0) selects 12:00 UTC', async () => {
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

    // The first card represents the day starting at hour 0, and the
    // noonIndex must point to the entry with getUTCHours() === 12.
    await user.click(screen.getAllByRole('button')[0])
    expect(onSelectHour).toHaveBeenCalledWith(12)
  })

  it('CEST location (offset=+2h) selects 10:00 UTC as local noon', async () => {
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
    // 12 - 2 = 10 UTC
    expect(onSelectHour).toHaveBeenCalledWith(10)
  })

  it('UTC-5 location selects 17:00 UTC as local noon', async () => {
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
    // (12 - (-5)) mod 24 = 17 UTC
    expect(onSelectHour).toHaveBeenCalledWith(17)
  })

  it('falls back to startIndex when no hour matches (e.g. 48h forecast over one day)', async () => {
    const onSelectHour = vi.fn()
    const user = userEvent.setup()
    // 24 hours starting at midnight UTC, location is UTC+12: local noon
    // would be 00:00 UTC, which only matches index 0. We assert it picks 0.
    const count = 24
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
    // localNoonUtcHour = (12 - 12) mod 24 = 0
    expect(onSelectHour).toHaveBeenCalledWith(0)
  })
})
/**
 * Tests for the day-filter feature on DailySummary.
 *
 * The user wants any click on a daily summary card to slice the
 * Insights table from that day's 00:00 without touching the URL
 * hour or the slider. DailySummary's existing `onSelectHour`
 * contract (millisecond-of-noon) stays in place for back-compat
 * and test fixtures; the new `onSelectDay` is the preferred path
 * the parent uses in production.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DailySummary from '@/components/DailySummary'
import { LocaleProvider } from '@/lib/LocaleContext'

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

function fakeLocalTimes(startUtcHour: number, count: number): Date[] {
  const out: Date[] = []
  for (let i = 0; i < count; i++) {
    out.push(new Date(Date.UTC(2026, 5, 10, startUtcHour, 0, 0) + i * 3600_000))
  }
  return out
}

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

describe('DailySummary — day filter (B-NEW-32)', () => {
  const count = 24 * 5 // 5 days so multiple cards render

  it('calls onSelectDay with the click index, noonIndex and label when the prop is provided', async () => {
    const onSelectDay = vi.fn()
    const user = userEvent.setup()
    render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={['gfs_global']}
        times={fakeLocalTimes(0, count)}
        series={flatSeries([20], count)}
        selectedHour={0}
        onSelectHour={vi.fn()}
        onSelectDay={onSelectDay}
        maxHours={count}
        utcOffsetSeconds={0}
      />
    ))
    const cards = screen.getAllByTestId('daily-card')
    expect(cards.length).toBeGreaterThanOrEqual(2)
    // Click the second card (which represents day 1, i.e. tomorrow).
    await user.click(cards[1])
    expect(onSelectDay).toHaveBeenCalledTimes(1)
    expect(onSelectDay).toHaveBeenCalledWith(expect.objectContaining({
      startIndex: 24,
      noonIndex: 36, // 24 + 12 = noon of the second day
      label: expect.stringMatching(/\d+/),
    }))
  })

  it('does NOT call onSelectHour when onSelectDay is provided', async () => {
    const onSelectHour = vi.fn()
    const onSelectDay = vi.fn()
    const user = userEvent.setup()
    render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={['gfs_global']}
        times={fakeLocalTimes(0, count)}
        series={flatSeries([20], count)}
        selectedHour={0}
        onSelectHour={onSelectHour}
        onSelectDay={onSelectDay}
        maxHours={count}
        utcOffsetSeconds={0}
      />
    ))
    const cards = screen.getAllByTestId('daily-card')
    await user.click(cards[0])
    expect(onSelectDay).toHaveBeenCalledTimes(1)
    expect(onSelectHour).not.toHaveBeenCalled()
  })

  it('falls back to onSelectHour when onSelectDay is omitted (legacy behaviour)', async () => {
    const onSelectHour = vi.fn()
    const user = userEvent.setup()
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
    const cards = screen.getAllByTestId('daily-card')
    await user.click(cards[0])
    expect(onSelectHour).toHaveBeenCalledWith(12)
  })

  it('marks the day rendered by activeDayStartIndex as aria-pressed, regardless of selectedHour', async () => {
    render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={['gfs_global']}
        times={fakeLocalTimes(0, count)}
        series={flatSeries([20], count)}
        // selectedHour points at the FIRST day but the filter says
        // the THIRD day is active. The filter wins.
        selectedHour={0}
        onSelectHour={vi.fn()}
        onSelectDay={vi.fn()}
        activeDayStartIndex={48}
        maxHours={count}
        utcOffsetSeconds={0}
      />
    ))
    const cards = screen.getAllByTestId('daily-card')
    // The card at index 2 covers day 2 = fullTimes[48..71].
    expect(cards[2].getAttribute('aria-pressed')).toBe('true')
    expect(cards[0].getAttribute('aria-pressed')).toBe('false')
  })

  it('falls back to selectedHour for aria-pressed when activeDayStartIndex is null', async () => {
    render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={['gfs_global']}
        times={fakeLocalTimes(0, count)}
        series={flatSeries([20], count)}
        selectedHour={36} // falls in the second day
        onSelectHour={vi.fn()}
        onSelectDay={vi.fn()}
        activeDayStartIndex={null}
        maxHours={count}
        utcOffsetSeconds={0}
      />
    ))
    const cards = screen.getAllByTestId('daily-card')
    expect(cards[1].getAttribute('aria-pressed')).toBe('true')
    expect(cards[0].getAttribute('aria-pressed')).toBe('false')
  })

  it('exposes a localised aria-label that mentions the filter intent when onSelectDay is set', async () => {
    render(wrap(
      <LocaleProvider initialLocale="en">
        <DailySummary
          models={MODELS}
          activeModelIds={['gfs_global']}
          times={fakeLocalTimes(0, count)}
          series={flatSeries([20], count)}
          selectedHour={0}
          onSelectHour={vi.fn()}
          onSelectDay={vi.fn()}
          maxHours={count}
          utcOffsetSeconds={0}
        />
      </LocaleProvider>
    ))
    const cards = screen.getAllByTestId('daily-card')
    expect(cards[0].getAttribute('aria-label')).toMatch(/Filter Insights/i)
  })
})

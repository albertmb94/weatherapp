/**
 * Tests for the day-filter rendering + autoscroll behaviours on the
 * Insights table.
 *
 * The user asked for two new behaviours on 2026-08-18:
 *
 *   1. When the parent passes a `dayFilter`, the table surfaces a
 *      "Desde ahora" / "From now" pill next to its title and the
 *      internal page index resets to 0 (the row count shrinks).
 *   2. Pagination CTAs scroll the user back to the top of the table
 *      both on desktop (internal scroll container) and on mobile
 *      portrait (the page is the scroll ancestor).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InsightsTable, { type InsightsDayFilter } from '@/components/InsightsTable'
import { LocaleProvider } from '@/lib/LocaleContext'
import type { WeatherModel } from '@/lib/models'

type SeriesLike = Record<string, Record<string, (number | null)[]>>

const MODELS: WeatherModel[] = [
  { id: 'gfs_global', label: 'GFS', color: '#fff', maxHours: 384, weight: 50, type: 'deterministic', region: 'global' },
  { id: 'ecmwf_ifs', label: 'ECMWF', color: '#0af', maxHours: 360, weight: 50, type: 'deterministic', region: 'global' },
]

const HOURS = 24 * 14

function fakeTimes(startUtcHour: number, count: number): Date[] {
  const out: Date[] = []
  for (let i = 0; i < count; i++) {
    out.push(new Date(Date.UTC(2026, 6, 10, startUtcHour, 0, 0) + i * 3600_000))
  }
  return out
}

function rampSeries(modelId: string, length: number, startTemp: number, slope: number): SeriesLike {
  const arr: (number | null)[] = []
  for (let i = 0; i < length; i++) arr.push(startTemp + i * slope)
  return {
    [modelId]: {
      temperature: arr,
      cloud_cover: Array.from({ length }, () => 50),
      wind_speed: Array.from({ length }, () => 5),
      wind_gusts: Array.from({ length }, () => 5),
      wind_direction: Array.from({ length }, () => 180),
      precipitation: Array.from({ length }, () => 0),
      humidity: Array.from({ length }, () => 50),
      uv_index: Array.from({ length }, () => 3),
      pressure: Array.from({ length }, () => 1013),
      dewpoint: Array.from({ length }, () => 10),
      visibility: Array.from({ length }, () => 10000),
    },
  } as unknown as SeriesLike
}

const SERIES: SeriesLike = {
  ...rampSeries('gfs_global', HOURS, 10, 0.5),
  ...rampSeries('ecmwf_ifs', HOURS, 14, 0.5),
}

function wrap(node: React.ReactNode) {
  // The production LocaleProvider reads navigator.language on mount
  // and switches to English if it starts with "en". jsdom's default
  // navigator.language is "en-US", which would silently flip the
  // locale for the assertions below. Force Spanish explicitly so the
  // copy matches the default the rest of the suite uses.
  return <LocaleProvider initialLocale="es">{node}</LocaleProvider>
}

/**
 * Pin `matchMedia` to known viewport states so the component's
 * `isMobilePortrait` flag resolves deterministically.
 */
function setMatchMedia(queries: Record<string, boolean>) {
  const createMql = (mq: string): MediaQueryList => ({
    matches: queries[mq] ?? false,
    media: mq,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((mq: string) => createMql(mq)),
  })
}

const PORTRAIT_Q = '(max-width: 767px) and (orientation: portrait)'

describe('InsightsTable — day filter (B-NEW-32)', () => {
  it('shows the "Desde ahora" pill only when dayFilter is set', () => {
    const { rerender } = render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={SERIES}
        bucket={1}
        onBucketChange={() => {}}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
        weekDays={14}
      />
    ))
    expect(screen.queryByTestId('clear-day-filter')).toBeNull()

    const filter: InsightsDayFilter = { startIndex: 48, anchor: 60, label: 'Mié 12' }
    rerender(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={SERIES}
        bucket={1}
        onBucketChange={() => {}}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
        weekDays={14}
        dayFilter={filter}
        onClearDayFilter={() => {}}
      />
    ))
    const btn = screen.getByTestId('clear-day-filter')
    expect(btn).toBeInTheDocument()
    expect(btn.textContent).toMatch(/Desde ahora/)
  })

  it('shows the pill label in English when locale is "en"', () => {
    const filter: InsightsDayFilter = { startIndex: 48, anchor: 60, label: 'Wed 12' }
    render(wrap(
      <LocaleProvider initialLocale="en">
        <InsightsTable
          models={MODELS}
          activeModelIds={['gfs_global', 'ecmwf_ifs']}
          times={fakeTimes(0, HOURS)}
          series={SERIES}
          bucket={1}
          onBucketChange={() => {}}
          selectedHour={0}
          onSelectHour={() => {}}
          maxHours={HOURS}
          utcOffsetSeconds={0}
          ensembleMode="wedai"
          weekDays={14}
          dayFilter={filter}
          onClearDayFilter={() => {}}
        />
      </LocaleProvider>
    ))
    expect(screen.getByTestId('clear-day-filter').textContent).toMatch(/From now/)
  })

  it('calls onClearDayFilter when the pill is clicked', async () => {
    const onClear = vi.fn()
    const user = userEvent.setup()
    const filter: InsightsDayFilter = { startIndex: 48, anchor: 60, label: 'Mié 12' }
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={SERIES}
        bucket={1}
        onBucketChange={() => {}}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
        weekDays={14}
        dayFilter={filter}
        onClearDayFilter={onClear}
      />
    ))
    await user.click(screen.getByTestId('clear-day-filter'))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('renders the filter label next to the title when dayFilter is set', () => {
    const filter: InsightsDayFilter = { startIndex: 48, anchor: 60, label: 'Mié 12' }
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={SERIES}
        bucket={1}
        onBucketChange={() => {}}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
        weekDays={14}
        dayFilter={filter}
        onClearDayFilter={() => {}}
      />
    ))
    expect(screen.getByTestId('insights-day-filter-label').textContent).toMatch(/Mié 12/)
  })

  it('mark the table root with data-day-filter="active" when filtered', () => {
    const filter: InsightsDayFilter = { startIndex: 48, anchor: 60, label: 'Mié 12' }
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={SERIES}
        bucket={1}
        onBucketChange={() => {}}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
        weekDays={14}
        dayFilter={filter}
        onClearDayFilter={() => {}}
      />
    ))
    expect(screen.getByTestId('insights-table').getAttribute('data-day-filter')).toBe('active')
  })

  it('resets the paginator to page 0 when the filter changes', async () => {
    const user = userEvent.setup()
    const baseProps = {
      models: MODELS,
      activeModelIds: ['gfs_global', 'ecmwf_ifs'] as string[],
      times: fakeTimes(0, HOURS),
      series: SERIES,
      bucket: 1 as const,
      onBucketChange: () => {},
      selectedHour: 0,
      onSelectHour: () => {},
      maxHours: HOURS,
      utcOffsetSeconds: 0,
      ensembleMode: 'wedai' as const,
      weekDays: 14 as const,
    }
    const { rerender } = render(wrap(<InsightsTable {...baseProps} />))
    // Advance to page 1.
    await user.click(screen.getByTestId('next-page-cta'))
    // Sanity: the page indicator now reports page 2 of 7.
    expect(screen.getByText(/Page 2 \/ 7|Pág. 2 \/ 7/i)).toBeInTheDocument()
    // Apply a filter and verify the page indicator resets.
    rerender(wrap(
      <InsightsTable
        {...baseProps}
        dayFilter={{ startIndex: 48, anchor: 60, label: 'Mié 12' }}
        onClearDayFilter={() => {}}
      />
    ))
    expect(screen.getByText(/Page 1 \/ \d+|Pág. 1 \/ \d+/i)).toBeInTheDocument()
  })

  /**
   * Regression: the "Cuándo" column labels must follow the filtered
   * slice, not the underlying `fullTimes`. The parent passes
   * `times = fullTimes.slice(dayFilter.startIndex)` and the same
   * reference as `fullTimes`, so the table uses `times[0]` as both
   * the first row date AND the "today" anchor for bucketLabel. When
   * the filter is on day 3, the first row label must be "Hoy 00h"
   * (where "Hoy" is day 3, not the wall-clock today).
   */
  it('rebases the "Cuándo" labels on the filtered day, not the unfiltered series', () => {
    const fullTimes = fakeTimes(0, HOURS)
    const filter: InsightsDayFilter = {
      startIndex: 24 * 3,
      anchor: 24 * 3 + 12,
      label: 'Day 3',
    }
    const slicedTimes = fullTimes.slice(filter.startIndex)
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={slicedTimes}
        fullTimes={slicedTimes}
        fullSeries={SERIES}
        series={SERIES}
        bucket={1}
        onBucketChange={() => {}}
        selectedHour={filter.anchor - filter.startIndex}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
        weekDays={14}
        dayFilter={filter}
        onClearDayFilter={() => {}}
      />
    ))
    const tbody = document.querySelector('tbody')!
    // Bucket=1 paginates at 48 rows per page; tbody also contains the
    // prev/next CTA rows, so we look at the first 48 entries which
    // are the actual data rows.
    const firstCells = tbody.querySelectorAll('tr td:nth-child(1)')
    const firstLabel = firstCells[0]?.textContent ?? ''
    const row24Label = firstCells[24]?.textContent ?? ''
    const row47Label = firstCells[47]?.textContent ?? ''
    // First row: the filtered day at 00:00 → "Hoy 00h".
    expect(firstLabel).toMatch(/Hoy 00h/)
    // Row 24: the filtered day + 1 at 00:00 → "Mañ 00h" (the day after the filter).
    expect(row24Label).toMatch(/Mañ 00h/)
    // Row 47: the filtered day + 1 at 23:00 → "Mañ 23h".
    expect(row47Label).toMatch(/Mañ 23h/)
  })

  /**
   * Regression for the bug reported on 2026-08-18: the labels
   * `today`/`tomorrow` were computed via `nowMs + utcOffsetSeconds * 1000`,
   * which is correct for +ve offsets (CEST) but off-by-one day for -ve
   * offsets (EST). With `utcOffsetSeconds = 7200` (CEST) and the filter
   * on the 3rd day, the first row must still read "Hoy 00h" (the
   * filtered day, not the wall-clock today).
   */
  it('rebase the labels on the filtered day under CEST (utcOffsetSeconds = +7200)', () => {
    const fullTimes = fakeTimes(0, HOURS)
    const filter: InsightsDayFilter = {
      startIndex: 24 * 3,
      anchor: 24 * 3 + 12,
      label: 'Day 3',
    }
    const slicedTimes = fullTimes.slice(filter.startIndex)
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={slicedTimes}
        fullTimes={slicedTimes}
        fullSeries={SERIES}
        series={SERIES}
        bucket={1}
        onBucketChange={() => {}}
        selectedHour={filter.anchor - filter.startIndex}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={7200}
        ensembleMode="wedai"
        weekDays={14}
        dayFilter={filter}
        onClearDayFilter={() => {}}
      />
    ))
    const tbody = document.querySelector('tbody')!
    const firstCells = tbody.querySelectorAll('tr td:nth-child(1)')
    expect(firstCells[0]?.textContent).toMatch(/Hoy 00h/)
    expect(firstCells[24]?.textContent).toMatch(/Mañ 00h/)
    expect(firstCells[47]?.textContent).toMatch(/Mañ 23h/)
  })

  /**
   * The same regression under a -ve offset (EST). The buggy
   * `nowMs + utcOffsetSeconds * 1000` formula computes `today` as
   * `local - 5h`, which puts the UTC date on the previous day. The
   * first row would then mislabel itself as "Mañ" instead of "Hoy".
   */
  it('rebase the labels on the filtered day under EST (utcOffsetSeconds = -18000)', () => {
    const fullTimes = fakeTimes(0, HOURS)
    const filter: InsightsDayFilter = {
      startIndex: 24 * 3,
      anchor: 24 * 3 + 12,
      label: 'Day 3',
    }
    const slicedTimes = fullTimes.slice(filter.startIndex)
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={slicedTimes}
        fullTimes={slicedTimes}
        fullSeries={SERIES}
        series={SERIES}
        bucket={1}
        onBucketChange={() => {}}
        selectedHour={filter.anchor - filter.startIndex}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={-18000}
        ensembleMode="wedai"
        weekDays={14}
        dayFilter={filter}
        onClearDayFilter={() => {}}
      />
    ))
    const tbody = document.querySelector('tbody')!
    const firstCells = tbody.querySelectorAll('tr td:nth-child(1)')
    expect(firstCells[0]?.textContent).toMatch(/Hoy 00h/)
    expect(firstCells[24]?.textContent).toMatch(/Mañ 00h/)
  })
})

describe('InsightsTable — autoscroll on pagination (B-NEW-32)', () => {
  beforeEach(() => setMatchMedia({ [PORTRAIT_Q]: false }))

  it('scrolls the internal container to top on desktop when the next-CTA is clicked', async () => {
    const user = userEvent.setup()
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={SERIES}
        bucket={1}
        onBucketChange={() => {}}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
        weekDays={14}
      />
    ))
    const container = screen.getByTestId('insights-table-scroll') as HTMLElement
    const scrollTo = vi.fn()
    container.scrollTo = scrollTo
    await user.click(screen.getByTestId('next-page-cta'))
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
  })

  it('calls scrollIntoView on the section when the previous-CTA is clicked on mobile portrait', async () => {
    setMatchMedia({ [PORTRAIT_Q]: true })
    const user = userEvent.setup()
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={SERIES}
        bucket={1}
        onBucketChange={() => {}}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
        weekDays={14}
      />
    ))
    // Advance to page 1 to make the prev CTA appear.
    await user.click(screen.getByTestId('next-page-cta'))
    const section = screen.getByTestId('insights-table')
    const scrollIntoView = vi.fn()
    ;(section as HTMLElement).scrollIntoView = scrollIntoView
    const prev = screen.getByTestId('prev-page-cta')
    await user.click(prev)
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }))
  })

  it('gracefully no-ops when matchMedia is missing (jsdom default)', async () => {
    // Force the matchMedia shim to be undefined so the scroll code
    // exercises the try/catch fallback.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    })
    const user = userEvent.setup()
    expect(() =>
      render(wrap(
        <InsightsTable
          models={MODELS}
          activeModelIds={['gfs_global', 'ecmwf_ifs']}
          times={fakeTimes(0, HOURS)}
          series={SERIES}
          bucket={1}
          onBucketChange={() => {}}
          selectedHour={0}
          onSelectHour={() => {}}
          maxHours={HOURS}
          utcOffsetSeconds={0}
          ensembleMode="wedai"
          weekDays={14}
        />
      ))
    ).not.toThrow()
    // The next-CTA must still work.
    await user.click(screen.getByTestId('next-page-cta'))
    expect(screen.getByText(/Page 2|Pág. 2/i)).toBeInTheDocument()
  })
})

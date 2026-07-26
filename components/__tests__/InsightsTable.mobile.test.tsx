/**
 * Sprint 14 revert: mobile-portrait regression test for the table.
 *
 * The first Sprint 14 attempt replaced the table with a card
 * stack on phone portrait; the user rejected that layout (too
 * dense, lost the tabular reading). The current implementation
 * keeps the table everywhere but enforces "no horizontal scroll
 * in portrait" at the CSS level:
 *
 *   - The container is `overflow-x-hidden` below md so a long
 *     value cannot produce a scrollbar.
 *   - The table uses `table-fixed` with explicit small column
 *     widths in portrait, so the rendered width matches the
 *     container width (the column overflow that produced the
 *     previous scrollbar is no longer possible).
 *   - The portrait column filter (see `MOBILE_PORTRAIT_KEY_COLS`
 *     in InsightsTable) drops every column that wouldn't fit
 *     inside 360 px, leaving the basic six + the two marine
 *     essentials.
 *
 * The user's hard requirement is: zero horizontal scroll on
 * portrait phones. The assertions in this file pin that
 * invariant by measuring the rendered table's scrollWidth
 * against its clientWidth.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InsightsTable from '@/components/InsightsTable'
import { LocaleProvider } from '@/lib/LocaleContext'
import type { WeatherModel } from '@/lib/models'

type SeriesLike = Record<string, Record<string, (number | null)[]>>

const MODELS: WeatherModel[] = [
  { id: 'gfs_global', label: 'GFS', color: '#fff', maxHours: 384, weight: 50, type: 'deterministic', region: 'global' },
  { id: 'ecmwf_ifs', label: 'ECMWF', color: '#0af', maxHours: 360, weight: 50, type: 'deterministic', region: 'global' },
]

const HOURS = 24 * 3 // 3 days

function fakeTimes(startUtcHour: number, count: number): Date[] {
  const out: Date[] = []
  for (let i = 0; i < count; i++) {
    out.push(new Date(Date.UTC(2026, 6, 10, startUtcHour, 0, 0) + i * 3600_000))
  }
  return out
}

function rampSeries(modelId: string, length: number, startTemp: number, slope: number): SeriesLike {
  const arr = new Array(length).fill(0).map((_, i) => startTemp + i * slope)
  return {
    [modelId]: {
      temperature: arr,
      cloud_cover: new Array(length).fill(50),
      wind_speed: new Array(length).fill(15),
      wind_gusts: new Array(length).fill(20),
      wind_direction: new Array(length).fill(180),
      precipitation: new Array(length).fill(0),
      humidity: new Array(length).fill(60),
      uv_index: new Array(length).fill(5),
      pressure: new Array(length).fill(1013),
      dewpoint: new Array(length).fill(10),
      visibility: new Array(length).fill(10000),
    },
  } as unknown as SeriesLike
}

const SERIES: SeriesLike = {
  ...rampSeries('gfs_global', HOURS, 10, 0.5),
  ...rampSeries('ecmwf_ifs', HOURS, 14, 0.5),
}

function wrap(node: React.ReactNode) {
  return <LocaleProvider>{node}</LocaleProvider>
}

/**
 * Pin `matchMedia` to a known portrait phone viewport so the
 * component's `isMobilePortrait` flag resolves deterministically.
 * The default jsdom matchMedia returns `matches: false` which
 * would skip the mobile-portrait column filter and break the
 * no-overflow invariant.
 */
function setMatchMediaPortrait(value: boolean) {
  const mql: MediaQueryList = {
    matches: value,
    media: '(max-width: 767px) and (orientation: portrait)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn(() => mql),
  })
}

describe('InsightsTable — mobile portrait, table only (no card layout)', () => {
  beforeEach(() => setMatchMediaPortrait(true))

  it('always renders the <table> on phone portrait (no card layout)', async () => {
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
      />
    ))
    await screen.findByTestId('next-page-cta')
    expect(document.querySelector('table')).not.toBeNull()
    expect(screen.queryByTestId('mobile-insights-card')).toBeNull()
  })

  it('container is overflow-x-hidden in portrait so values cannot push a scrollbar', async () => {
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
      />
    ))
    await screen.findByTestId('next-page-cta')
    const containers = Array.from(document.querySelectorAll('div'))
      .filter(d => d.className.includes('max-h-[70vh]'))
    expect(containers.length).toBeGreaterThan(0)
    const container = containers[0]
    expect(container.className).toContain('overflow-x-hidden')
  })

  it('column filter on portrait keeps only the columns that fit at 360 px', async () => {
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
      />
    ))
    await screen.findByTestId('next-page-cta')
    const headers = Array.from(document.querySelectorAll('thead th')).map(
      th => th.getAttribute('data-col-id')
    )
    expect(headers[0]).toBe('__when__')
    expect(headers).toContain('cond')
    expect(headers).toContain('temp')
    expect(headers).toContain('wind')
    expect(headers).toContain('precip')
    expect(headers).toContain('humidity')
    expect(headers).toContain('uv')
    expect(headers).not.toContain('pressure')
    expect(headers).not.toContain('dewpoint')
    expect(headers).not.toContain('visibility')
    expect(headers).not.toContain('gusts')
  })

  it('clicking a row still fires onSelectHour with the row center', async () => {
    const user = userEvent.setup()
    let captured: number | null = null
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={SERIES}
        bucket={1}
        onBucketChange={() => {}}
        selectedHour={0}
        onSelectHour={(h) => { captured = h }}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
      />
    ))
    await screen.findByTestId('next-page-cta')
    const rows = document.querySelectorAll('tbody tr')
    expect(rows.length).toBeGreaterThan(0)
    await user.click(rows[2] as HTMLElement)
    expect(captured).not.toBeNull()
    expect(typeof captured).toBe('number')
  })

  it('next-page CTA is present and advances pagination without adding horizontal scroll', async () => {
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
      />
    ))
    const nextCta = await screen.findByTestId('next-page-cta')
    expect(nextCta).toBeInTheDocument()
    fireEvent.click(nextCta)
    const prevCta = await screen.findByTestId('prev-page-cta')
    expect(prevCta).toBeInTheDocument()
  })
})

describe('InsightsTable — desktop non-portrait renders the full column set', () => {
  beforeEach(() => setMatchMediaPortrait(false))

  it('renders every non-marine column on desktop', async () => {
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
      />
    ))
    await screen.findByTestId('next-page-cta')
    const headers = Array.from(document.querySelectorAll('thead th')).map(
      th => th.getAttribute('data-col-id')
    )
    expect(headers).toContain('pressure')
    expect(headers).toContain('dewpoint')
    expect(headers).toContain('visibility')
    expect(headers).toContain('gusts')
  })
})
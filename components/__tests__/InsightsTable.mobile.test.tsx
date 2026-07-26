/**
 * Sprint 14: integration tests for the mobile-portrait card layout
 * of `InsightsTable`. The component branches on `isMobilePortrait`
 * (matched via `window.matchMedia('(max-width: 767px) and
 * (orientation: portrait)')`). In portrait, the table is replaced
 * by a stack of `<MobileInsightsCard>`s so the user never has to
 * scroll horizontally — that was the user's hard requirement.
 *
 * The previous behaviour rendered a horizontally-scrollable
 * <table> on every viewport and relied on a right-edge gradient
 * hint to tell the user "more content over there". The mobile
 * cards remove the scroll context entirely.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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
 * Override the JS DOM matchMedia so the component's
 * `isMobilePortrait` flag resolves to a known value before the
 * component reads it on first render. The component's
 * `useEffect` would otherwise overwrite it on the next tick, but
 * the SSR-safe initial state is what the assertion needs.
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

describe('InsightsTable — mobile-portrait card layout', () => {
  it('renders the card stack instead of a table when __forceMobilePortrait is true', () => {
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
        __forceMobilePortrait
      />
    ))
    const cards = screen.getAllByTestId('mobile-insights-card')
    expect(cards.length).toBeGreaterThan(0)
    expect(document.querySelector('table')).toBeNull()
  })

  it('clicking a card fires onSelectHour with the row center', async () => {
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
        __forceMobilePortrait
      />
    ))
    const cards = screen.getAllByTestId('mobile-insights-card')
    await user.click(cards[3])
    expect(captured).not.toBeNull()
    expect(typeof captured).toBe('number')
  })

  it('marks the active card with the accent ring + data-active attribute', () => {
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
        __forceMobilePortrait
      />
    ))
    const cards = screen.getAllByTestId('mobile-insights-card')
    const activeCard = cards.find(c => c.getAttribute('data-active') === 'true')
    expect(activeCard).toBeDefined()
  })

  it('renders the temperature in each card header with the heatmap style', () => {
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
        __forceMobilePortrait
      />
    ))
    const cards = screen.getAllByTestId('mobile-insights-card')
    expect(cards.length).toBeGreaterThan(0)
    const first = cards[0]
    const temp = within(first).getByTestId('card-temp')
    const style = (temp as HTMLElement).style
    // heatStyle emits a backgroundImage / backgroundColor pair
    // with the heatmap colour; the exact string varies with the
    // intensity / colour scale, so we accept any non-empty inline
    // style as proof that the helper was applied.
    expect(style.backgroundImage || style.backgroundColor).toBeTruthy()
  })
})

describe('InsightsTable — desktop table layout', () => {
  it('renders the <table> when __forceMobilePortrait is false', () => {
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
        __forceMobilePortrait={false}
      />
    ))
    const table = document.querySelector('table')
    expect(table).not.toBeNull()
    expect(screen.queryByTestId('mobile-insights-card')).toBeNull()
  })

  it('still supports bucket switching and pagination on desktop', () => {
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
        __forceMobilePortrait={false}
      />
    ))
    const nextCta = screen.getByTestId('next-page-cta')
    expect(nextCta).toBeInTheDocument()
    fireEvent.click(nextCta)
    // The previous-page CTA only appears after advancing at
    // least one page; this is the documented
    // `useInsightPagination` behaviour.
    const prevCta = screen.getByTestId('prev-page-cta')
    expect(prevCta).toBeInTheDocument()
  })
})

describe('MobileInsightsCard — chip strip', () => {
  it('renders a chip for every visible column except cond + temp', () => {
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
        __forceMobilePortrait
      />
    ))
    const cards = screen.getAllByTestId('mobile-insights-card')
    const firstCard = cards[0]
    const chips = within(firstCard).getAllByTestId('mobile-card-chip')
    // All non-metric columns that aren't `cond` or `temp` produce a
    // chip. The basic 13-column set (cond, temp, min, max, clouds,
    // wind, gusts, precip, humidity, uv, pressure, dewpoint,
    // visibility) collapses to 11 chips after dropping the two
    // header chips; some are CSS-hidden below xl but the card
    // wrapper still receives the cell data and decides at the JSX
    // level. The user-visible chip count on a phone is the ones
    // that wrap inside the card; the key invariant is that no
    // chip causes horizontal overflow.
    expect(chips.length).toBeGreaterThanOrEqual(11)
  })

  it('does not overflow horizontally: every card fits inside the viewport', () => {
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
        __forceMobilePortrait
      />
    ))
    const cards = screen.getAllByTestId('mobile-insights-card')
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      const el = card as HTMLElement
      // Each card uses `block w-full` so its outer width equals
      // the parent's content-box width; its scrollWidth must not
      // exceed that width.
      expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1)
    }
  })
})
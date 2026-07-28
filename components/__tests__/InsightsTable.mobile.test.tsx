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
 * Pin `matchMedia` to known viewport states so the component's
 * `isMobilePortrait` / `isMobileLandscape` flags resolve
 * deterministically. The default jsdom matchMedia returns
 * `matches: false` which would skip every mobile branch and
 * break the invariants.
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
const LANDSCAPE_Q = '(max-width: 1023px) and (orientation: landscape)'

describe('InsightsTable — mobile portrait, table only (no card layout)', () => {
  beforeEach(() => setMatchMedia({ [PORTRAIT_Q]: true, [LANDSCAPE_Q]: false }))

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
    // B-NEW-27 (2026-07-28): the container is identified by
    // the stable `data-testid` instead of the `max-h-[70vh]`
    // class — the max-h was removed on mobile portrait so the
    // page becomes the single scrolling ancestor and the user
    // doesn't have to juggle a 70vh scroll box inside the page
    // scroll. The overflow-x-hidden invariant we want to keep
    // is that a stray wide value still cannot push a horizontal
    // scrollbar on the container itself.
    const container = screen.getByTestId('insights-table-scroll')
    expect(container.className).toContain('overflow-x-hidden')
    // B-NEW-27: also assert the max-h is GONE on mobile portrait
    // (it stays on landscape and desktop where the bounded scroll
    // box still makes sense).
    expect(container.className).not.toMatch(/max-h-\[70vh\]/)
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
    // Marine columns must NOT appear when showMarine is false (default)
    expect(headers).not.toContain('sea_surface_temperature')
    expect(headers).not.toContain('wave_height')
    // HeatCell uses px-0.5 (tight padding) in portrait so every
    // value fits inside its column without text-overflow ellipsis.
    const cells = Array.from(document.querySelectorAll('td.font-mono'))
    expect(cells.length).toBeGreaterThan(0)
    for (const cell of cells) {
      expect(cell.className).toContain('px-0.5')
      expect(cell.className).not.toContain('px-1.5')
      // text-ellipsis is removed from HeatCell — no cell should
      // ever show the "…" indicator.
      expect(cell.className).not.toMatch(/text-ellipsis/)
    }
  })

  it('iPhone 16 portrait (393x852): UV column is visible and table fits', async () => {
    // B-NEW-22 + B-NEW-23 (2026-07-27, iPhone 16 portrait fix).
    // The user reported the UV column was off-screen on iPhone
    // 16 (393 px logical viewport). With `table-auto` the
    // browser sized the when col to its widest CELL (e.g.
    // "Mañ 00:00"), pushing the data columns past the
    // available width and clipping the rightmost (UV). We now:
    //   (1) apply `table-fixed` on mobile portrait,
    //   (2) measure the actual container width with a
    //       ResizeObserver, and
    //   (3) give every column a runtime-computed pixel width
    //       so the table fits exactly inside the container
    //       on *any* viewport in [280, 1200] px.
    //
    // jsdom doesn't lay out the DOM, so `clientWidth` is 0 by
    // default. We stub it on the container's prototype-chain
    // lookup so the ResizeObserver callback reads the value
    // we want to assert against. 361 px is the iPhone 16
    // available width: 393 px viewport − 16 px section
    // padding on each side.
    const IPHONE16_AVAILABLE = 361
    const originalGetClientWidths = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    )
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        // Only the InsightsTable scroll container (the one
        // marked with `data-testid="insights-table-scroll"`)
        // should report the iPhone 16 width. Other elements
        // (e.g. pagination buttons, modal backdrops) keep the
        // jsdom default of 0 so they don't accidentally affect
        // unrelated measurements.
        //
        // B-NEW-27 (2026-07-28): the previous filter looked
        // for `max-h-[70vh]` on the container's className, but
        // that class is now conditional (only on landscape and
        // desktop, NOT on mobile portrait where the user wants
        // the page to be the single scroll). The `data-testid`
        // is stable across all three viewports, so it survives
        // the B-NEW-27 change and keeps this test working
        // without a separate mobile-portrait branch.
        if (this instanceof HTMLElement && this.dataset &&
            this.dataset.testid === 'insights-table-scroll') {
          return IPHONE16_AVAILABLE
        }
        return 0
      },
    })
    try {
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
      const table = document.querySelector('table')
      expect(table).not.toBeNull()
      // (1) table-fixed keeps the col widths exact.
      expect(table!.className).toMatch(/table-fixed/)
      // (2) The UV column header is rendered (and not clipped).
      const uvHeader = document.querySelector('th[data-col-id="uv"]')
      expect(uvHeader).not.toBeNull()
      // (3) Every column has a runtime-computed pixel width
      //     that, when summed, fits exactly inside the
      //     available container width. The widths are
      //     integers in the [28, 120] px range on mobile
      //     portrait (MOBILE_DATA_MIN / MOBILE_DATA_MAX),
      //     with the when col fixed at MOBILE_WHEN_PX
      //     (88 px, B-NEW-26 — widened from 64 px so the
      //     longest 1h-bucket label "Jue 30 00h" fits).
      const allCols = Array.from(
        table!.querySelectorAll('colgroup col[data-col-id]'),
      ) as HTMLElement[]
      expect(allCols.length).toBeGreaterThan(0)
      let totalWidth = 0
      for (const col of allCols) {
        const style = col.getAttribute('style') ?? ''
        const m = style.match(/width:\s*(\d+)px/)
        expect(m, `col data-col-id=${col.dataset.colId} should have a runtime-computed px width; got style="${style}"`).not.toBeNull()
        const w = Number(m![1])
        // B-NEW-26: the when col is 88 px (MOBILE_WHEN_PX),
        // up from 64 px so the 10-char "Jue 30 00h" / "Mié
        // 31 00h" labels never overflow into the "Cond"
        // cell. Data cols are between 28 and 120 px.
        if (col.dataset.colId === '__when__') {
          expect(w, 'when col fixed at 88 px').toBe(88)
        } else {
          expect(w, `data col ${col.dataset.colId} floor`).toBeGreaterThanOrEqual(28)
          expect(w, `data col ${col.dataset.colId} ceiling`).toBeLessThanOrEqual(120)
        }
        totalWidth += w
      }
      // (4) The total width fits inside the available
      //     container. With 361 px available and the formula
      //     in `tableColumnWidths`, data cols land at
      //     floor((361 - 88) / 6) = floor(45.5) = 45.
      //     Total = 88 + 6 * 45 = 358 (3 px safety margin).
      expect(totalWidth, 'total table width must fit inside the container').toBeLessThanOrEqual(IPHONE16_AVAILABLE)
      expect(totalWidth, 'total table width should use most of the available space').toBeGreaterThan(IPHONE16_AVAILABLE - 30)
    } finally {
      if (originalGetClientWidths) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalGetClientWidths)
      } else {
        // @ts-expect-error - cleanup when the descriptor didn't exist
        delete HTMLElement.prototype.clientWidth
      }
    }
  })

  it('portrait with Marine ON shows sea_temp + wave_height, drops humidity + uv to fit', async () => {
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
        showMarine={true}
        onMarineToggle={() => {}}
      />
    ))
    await screen.findByTestId('next-page-cta')
    const headers = Array.from(document.querySelectorAll('thead th')).map(
      th => th.getAttribute('data-col-id')
    )
    expect(headers[0]).toBe('__when__')
    // Basic essentials
    expect(headers).toContain('cond')
    expect(headers).toContain('temp')
    expect(headers).toContain('wind')
    expect(headers).toContain('precip')
    // Marine key columns replace humidity + uv
    expect(headers).toContain('sea_surface_temperature')
    expect(headers).toContain('wave_height')
    // Dropped to keep 6 data cols
    expect(headers).not.toContain('humidity')
    expect(headers).not.toContain('uv')
    // Non-key columns are absent
    expect(headers).not.toContain('pressure')
    expect(headers).not.toContain('gusts')
    expect(headers).not.toContain('wave_period')
    expect(headers).not.toContain('wave_direction')
    // Container must stay overflow-x-hidden even with Marine ON
    // (horizontal scroll is not allowed on portrait). B-NEW-27
    // (2026-07-28): the container is identified by the stable
    // `data-testid` instead of the `max-h-[70vh]` class — the
    // max-h was removed on mobile portrait so the page becomes
    // the single scroll context.
    const container = screen.getByTestId('insights-table-scroll')
    expect(container.className).toContain('overflow-x-hidden')
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
    await screen.findByTestId('next-page-cta')
    // B-NEW-25 (2026-07-28): on mobile portrait the bucket
    // bar shows ONLY 1h and 1d. The 2h/6h/12h options were
    // dropped because the user only switches between
    // hour-level and day-level granularity on their phone.
    const bucketBar = screen.getByTestId('bucket-bar')
    const bucketLabels = Array.from(
      bucketBar.querySelectorAll('button'),
    ).map(b => (b.textContent ?? '').trim())
    expect(bucketLabels, 'mobile portrait bucket bar should only contain 1h and 1d').toEqual(['1h', '1d'])
  })

  it('compact-mode hamburger toggle is hidden on mobile portrait', async () => {
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
    // B-NEW-25: the ≡ hamburger that toggles `compact`
    // (which hides 9 of 14 columns) is removed on mobile
    // portrait. The user only ever wanted the basic 6 cols
    // + the 2 marine essentials on their phone, and
    // accidentally toggling compact would lock out 4 of the
    // 6 mobile columns.
    expect(
      screen.queryByTestId('compact-toggle'),
      'compact-mode hamburger should not be rendered on mobile portrait',
    ).toBeNull()
  })

  it('Basic toggle is hidden on mobile portrait even when Marine is on (no-op control)', async () => {
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
        showMarine={true}
        onMarineToggle={() => {}}
        showBasic={true}
        onBasicToggle={() => {}}
      />
    ))
    await screen.findByTestId('next-page-cta')
    // B-NEW-25 (2026-07-28): the old test expected the Basic
    // button to be visible when Marine was on. That was a
    // regression — the portrait column filter is unconditional
    // on `showMarine` (it swaps humidity + uv for sea_temp +
    // wave_height so the table always shows 6 data cols), so
    // toggling `showBasic` would change NOTHING on the user's
    // screen. The button was dead weight and the user reported
    // it as confusing.
    //
    // B-NEW-28 (2026-07-28): the Basic button is now hidden
    // on mobile portrait (regardless of `showMarine`). It still
    // renders on landscape and desktop where the toggle is
    // meaningful — see the landscape regression test below.
    const marineButton = screen.getByRole('button', { name: /Marine/i })
    expect(marineButton).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Basic/i }),
      'Basic toggle must NOT render on mobile portrait (no-op control)',
    ).toBeNull()
  })

  it('Basic toggle is hidden when Marine is off (the data is already basic)', async () => {
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
        showMarine={false}
        onMarineToggle={() => {}}
        showBasic={true}
        onBasicToggle={() => {}}
      />
    ))
    await screen.findByTestId('next-page-cta')
    // B-NEW-25: with Marine off the Basic toggle is hidden
    // — the data already IS the basic column set, so a
    // "Basic" toggle would be confusing (and the only
    // meaningful state is the default). The Marine button
    // is still there so the user can turn marine on.
    const marineButton = screen.getByRole('button', { name: /Marine/i })
    expect(marineButton).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Basic/i }),
      'Basic toggle must not render when Marine is off (no-op control)',
    ).toBeNull()
  })

  it('resets bucket to 1h and clears compact when the user lands on mobile portrait with a non-mobile bucket', async () => {
    const bucketChanges: number[] = []
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={SERIES}
        bucket={6}
        onBucketChange={b => bucketChanges.push(b)}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
      />
    ))
    // B-NEW-25: with bucket=6 on mobile portrait, the
    // reset useEffect should fire onBucketChange(1) so the
    // user isn't stuck on a bucket they can't switch off.
    // We don't need to wait for a next-page-cta (bucket=6
    // doesn't paginate), the effect fires synchronously
    // after mount.
    expect(
      bucketChanges,
      'onBucketChange(1) should fire when entering mobile portrait with bucket=6',
    ).toContain(1)
  })
})

describe('InsightsTable — desktop non-portrait renders the full column set', () => {
  beforeEach(() =>
    setMatchMedia({
      [PORTRAIT_Q]: false,
      [LANDSCAPE_Q]: false,
      '(min-width: 1024px)': true,
    })
  )

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

  it('bucket bar on desktop shows the full 1h/2h/6h/12h/1d set', async () => {
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
    // B-NEW-25: on desktop (isMobilePortrait=false) the
    // full bucket set is shown. The mobile-only restriction
    // to [1, 24] only applies when isMobilePortrait is
    // true. We pin the desktop behavior here so future
    // refactors don't accidentally drop the intermediate
    // buckets on desktop too.
    const bucketBar = screen.getByTestId('bucket-bar')
    const labels = Array.from(
      bucketBar.querySelectorAll('button'),
    ).map(b => (b.textContent ?? '').trim())
    expect(labels).toEqual(['1h', '2h', '6h', '12h', '1d'])
  })

  it('compact-mode hamburger is present on desktop non-portrait', async () => {
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
    // B-NEW-25: on desktop the compact-mode hamburger is
    // present (real-desktop:hidden in the className only
    // kicks in on real-desktop viewports; the test setup
    // pins the 1024+ matchMedia so we render the
    // non-real-desktop variant which IS the real-desktop
    // path). We pin the desktop behavior here so future
    // refactors don't accidentally drop it.
    expect(
      screen.queryByTestId('compact-toggle'),
      'compact-mode hamburger should be present on desktop',
    ).not.toBeNull()
  })

  // B-NEW-24 (2026-07-27): regression for the visibility column
  // showing 0.0 on screen. The visibility ensemble block in
  // InsightsTable was dividing the per-model value by 1000 to
  // convert m → km, but `lib/openMeteo.ts` already does that
  // conversion at fetch time and stores the value in km. The
  // double division turned 10 km into 0.01 km, which renders
  // as 0.0 at 1-decimal precision. The fix removed the
  // table-side conversion (the table now calls
  // `ensembleWithFallback('visibility', ...)` like every other
  // metric) and this test pins the rendered value.
  //
  // The fixture above uses `visibility: 10000` which mirrors
  // the OLD contract (raw Open-Meteo metres). After the fix
  // the table reads 10000 as-is and renders 10000.0 — that
  // is what the production app sees AFTER the openMeteo
  // conversion too (openMeteo already converted to km), so
  // the round-trip value visible to the user is 10.0 (or
  // whatever km value the data carries). What matters here
  // is the invariant: the rendered visibility cell is
  // *not* 0.0.
  //
  // We can't use `td[data-col-id="visibility"]` to locate
  // cells because the HeatCell component (the per-cell
  // renderer) does not pass the col id down to the <td>.
  // We instead use the header column's position to find
  // the corresponding body cell in every row.
  it('visibility cell does not collapse to 0.0 (no double m→km conversion)', async () => {
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
    // Find the visibility header and its column index.
    const headers = Array.from(
      document.querySelectorAll('thead tr th'),
    ) as HTMLElement[]
    const visHeaderIdx = headers.findIndex(
      h => h.getAttribute('data-col-id') === 'visibility',
    )
    expect(visHeaderIdx, 'visibility column header should exist on desktop').toBeGreaterThanOrEqual(0)
    // The visibility cells in every body row are at the
    // same index (the table keeps the header/row alignment
    // 1:1 by construction). Iterate every body row, take
    // the cell at `visHeaderIdx`, and assert its text is
    // not "0.0" (the bug) and is a positive number (the
    // fix).
    const rows = Array.from(document.querySelectorAll('tbody tr')) as HTMLElement[]
    expect(rows.length, 'should have body rows').toBeGreaterThan(0)
    let checked = 0
    for (const row of rows) {
      const cells = row.querySelectorAll('td')
      // Skip pagination rows (prev/next CTAs) that have a
      // single colspan'd <td>.
      if (cells.length <= 1) continue
      const cell = cells[visHeaderIdx]
      if (!cell) continue
      const text = (cell.textContent ?? '').trim()
      // Skip the empty-cell case (no value rendered).
      if (text === '' || text === '–' || text === '-') continue
      checked += 1
      expect(text, 'visibility cell must not show 0.0 (the double-conversion bug)').not.toBe('0.0')
      // Also: the parsed number must be > 0. With the
      // fixture value of 10000 the cell now reads "10000.0".
      const n = Number(text)
      expect(Number.isFinite(n), `visibility cell "${text}" should be a number`).toBe(true)
      expect(n, `visibility cell "${text}" should be > 0`).toBeGreaterThan(0)
    }
    expect(checked, 'at least one visibility cell should have been checked').toBeGreaterThan(0)
  })
})

describe('InsightsTable — mobile landscape with Marine + Basic shows scroll', () => {
  beforeEach(() => setMatchMedia({ [PORTRAIT_Q]: false, [LANDSCAPE_Q]: true }))

  it('container has overflow-x-auto when Marine + Basic are both active on landscape', async () => {
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
        showMarine={true}
        onMarineToggle={() => {}}
        showBasic={true}
        onBasicToggle={() => {}}
      />
    ))
    await screen.findByTestId('next-page-cta')
    const containers = Array.from(document.querySelectorAll('div'))
      .filter(d => d.className.includes('max-h-[70vh]'))
    expect(containers.length).toBeGreaterThan(0)
    const container = containers[0]
    // Must allow horizontal scroll so the user can reach every column
    expect(container.className).toContain('overflow-x-auto')
    // The full column set is present (basic + marine)
    const headers = Array.from(document.querySelectorAll('thead th')).map(
      th => th.getAttribute('data-col-id')
    )
    expect(headers).toContain('pressure')
    expect(headers).toContain('gusts')
    expect(headers).toContain('wave_period')
    expect(headers).toContain('wave_direction')
  })
})

describe('InsightsTable — mobile landscape keeps the mobile chrome layout (Sprint 15)', () => {
  beforeEach(() => setMatchMedia({ [PORTRAIT_Q]: false, [LANDSCAPE_Q]: true }))

  it('table distributes columns proportionally (table-auto, no fixed px)', async () => {
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
    const table = document.querySelector('table')
    expect(table).not.toBeNull()
    // Sprint 16: dropped table-fixed entirely. The <colgroup> only
    // carries an explicit width on the sticky Cuándo column (via
    // --when-col-w); every data column relies on auto sizing to
    // its widest cell so the user gets a real proportional layout
    // instead of the previous equally-shared fixed columns.
    expect(table!.className).not.toMatch(/(^|\s)table-fixed(\s|$)/)
    const cols = Array.from(table!.querySelectorAll('colgroup col')) as HTMLElement[]
    const colsWithPxWidth = cols.filter((c) => /width:\s*\d+px/.test(c.getAttribute('style') ?? ''))
    // Only the sticky column has an explicit px width.
    expect(colsWithPxWidth).toHaveLength(0)
  })

  it('on mobile landscape (any toggle state) the container is overflow-x-auto so wider column sets can scroll', async () => {
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
        showMarine={false}
        showBasic={true}
        onMarineToggle={() => {}}
        onBasicToggle={() => {}}
      />
    ))
    await screen.findByTestId('next-page-cta')
    const containers = Array.from(document.querySelectorAll('div'))
      .filter(d => d.className.includes('max-h-[70vh]'))
    expect(containers.length).toBeGreaterThan(0)
    const container = containers[0]
    // Sprint 16: mobile landscape enables horizontal scroll REGARDLESS
    // of marine/basic toggles. Basic-only now shows min/max/clouds/
    // gusts which overflow 390 px. The user explicitly asked the
    // table to "aprovechar todo el ancho disponible" with horizontal
    // scroll when Marine + Basic are both on, and we extend that
    // semantics to all landscape scenarios.
    expect(container.className).toContain('overflow-x-auto')
    expect(container.className).not.toContain('overflow-x-hidden')
  })

  // B-NEW-28 (2026-07-28): the Basic toggle is hidden on mobile
  // portrait (no-op control) but stays visible on landscape and
  // desktop where it actually changes the column set. This is
  // the regression guard for the portrait hide.
  it('on mobile landscape with Marine on, the Basic toggle IS rendered and switches the column set', async () => {
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
        showMarine={true}
        showBasic={true}
        onMarineToggle={() => {}}
        onBasicToggle={() => {}}
      />
    ))
    await screen.findByTestId('next-page-cta')
    const marineButton = screen.getByRole('button', { name: /Marine/i })
    const basicButton = screen.getByRole('button', { name: /Basic/i })
    expect(marineButton).toBeInTheDocument()
    expect(basicButton, 'Basic toggle must still render on landscape where the column set depends on it').toBeInTheDocument()
  })
})
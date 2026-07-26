/**
 * Test for B-10-2: the active row of the InsightsTable in bucket=24
 * must show a small "↳ Ahora · XX°" annotation above the day label so
 * the user understands that the tempMean shown is the CURRENT hour's
 * temperature (WedAI-forced, after B-10-1), not the daily average.
 *
 * The chip must NOT appear when:
 *   - bucket != 24 (bucket=1 already labels the row by hour, so the
 *     chip would be redundant)
 *   - the row is not active (only the active row has tempMean = Ahora)
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InsightsTable from '@/components/InsightsTable'
import { LocaleProvider } from '@/lib/LocaleContext'
import type { WeatherModel } from '@/lib/models'

type SeriesLike = Record<string, Record<string, (number | null)[]>>

const MODELS: WeatherModel[] = [
  {
    id: 'gfs_global',
    label: 'GFS',
    color: '#fff',
    maxHours: 384,
    weight: 50,
    type: 'deterministic',
    region: 'global',
  },
  {
    id: 'ecmwf_ifs',
    label: 'ECMWF',
    color: '#0af',
    maxHours: 360,
    weight: 50,
    type: 'deterministic',
    region: 'global',
  },
]

/**
 * Build 24h × 14d of UTC-fake-local timestamps starting at the
 * supplied hour so DailySummary-like days line up nicely.
 */
function fakeTimes(startUtcHour: number, count: number): Date[] {
  const out: Date[] = []
  for (let i = 0; i < count; i++) {
    out.push(
      new Date(Date.UTC(2026, 6, 10, startUtcHour, 0, 0) + i * 3600_000)
    )
  }
  return out
}

/**
 * Build a series with a per-hour temperature ramp so the active row's
 * tempMean at hour H is unambiguous.
 */
function rampSeries(modelId: string, length: number, startTemp: number, slope: number) {
  const arr: number[] = []
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
  } as const
}

function wrap(node: React.ReactNode) {
  return <LocaleProvider>{node}</LocaleProvider>
}

describe('InsightsTable — "↳ Ahora" annotation on active row', () => {
  const HOURS = 24 * 14 // 14 days
  const series: SeriesLike = {
    ...rampSeries('gfs_global', HOURS, 10, 0.5),  // 10°C at h0, ramps up
    ...rampSeries('ecmwf_ifs', HOURS, 14, 0.5),  // 14°C at h0, ramps up
  }

  it('shows the chip on the first row when bucket=24 and selectedHour=0', () => {
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={series}
        fullTimes={fakeTimes(0, HOURS)}
        fullSeries={series}
        startIndex={0}
        bucket={24}
        onBucketChange={() => {}}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
        weekDays={14}
      />
    ))
    // The chip must appear at least once and reference the active hour's temp.
    const chip = screen.getByText(/Ahora/)
    expect(chip).toBeInTheDocument()
    // The chip should contain a degree value.
    expect(chip.textContent).toMatch(/\d+°/)
  })

  it('does NOT show the chip on bucket=1 (the row label is already hourly)', () => {
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={series}
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
    // No "↳ Ahora" chip anywhere.
    expect(screen.queryByText(/Ahora/)).toBeNull()
  })

  it('does NOT show the chip when selectedHour points at a future day', () => {
    // selectedHour=24 means "tomorrow at the same hour"; in bucket=24
    // the active row is Mañ (tomorrow), not Hoy.
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={series}
        fullTimes={fakeTimes(0, HOURS)}
        fullSeries={series}
        startIndex={0}
        bucket={24}
        onBucketChange={() => {}}
        selectedHour={24}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
        weekDays={14}
      />
    ))
    expect(screen.queryByText(/Ahora/)).toBeNull()
  })
})

/**
 * Sprint 10 / B-10-7 — pagination (48 h pages) + sticky headers.
 *
 * The previous "render every row up front" approach (B-10-6) still
 * triggered noticeable slowdowns on bucket=1 (336 rows) because the
 * React reconciliation + the inline radial-gradient per cell run
 * for every row regardless of viewport. We now mount 48 rows at a
 * time (PAGE_SIZE) and add a CTA row at the bottom to load the next
 * page; only bucket=24 / bucket=12 short pages render without the
 * CTA. The container is scrollable internally so sticky thead can
 * do its job.
 */
describe('InsightsTable — pagination + sticky headers (B-10-7)', () => {
  const HOURS = 24 * 14 // 14 days
  const series: SeriesLike = {
    ...rampSeries('gfs_global', HOURS, 10, 0),
    ...rampSeries('ecmwf_ifs', HOURS, 20, 0),
  }
  const PAGE_SIZE = 48

  it('bucket=1 mounts PAGE_SIZE rows + a next-CTA on page 0', () => {
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={series}
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
    const tbody = document.querySelector('tbody')!
    const rows = tbody.querySelectorAll('tr')
    // 48 data rows + 1 CTA row = 49.
    expect(rows.length).toBe(PAGE_SIZE + 1)
    // The CTA is the LAST row.
    const cta = tbody.querySelector('[data-testid="next-page-cta"]')
    expect(cta).not.toBeNull()
    expect(cta!.getAttribute('role')).toBe('button')
    expect(cta!.textContent).toMatch(/Mostrar siguientes 48 h|Show next 48 h/i)
    expect(cta!.textContent).toMatch(/288 filas restantes|288 rows remaining/i)
  })

  it('bucket=2 mounts PAGE_SIZE rows + a next-CTA (168 total)', () => {
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={series}
        bucket={2}
        onBucketChange={() => {}}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
        weekDays={14}
      />
    ))
    const tbody = document.querySelector('tbody')!
    const rows = tbody.querySelectorAll('tr')
    expect(rows.length).toBe(PAGE_SIZE + 1)
    // Total = 336 / 2 = 168 → 168 - 48 = 120 rows remaining after page 0.
    const cta = tbody.querySelector('[data-testid="next-page-cta"]')!
    expect(cta.textContent).toMatch(/120 filas restantes|120 rows remaining/i)
  })

  it('bucket=6 needs only 2 pages; page 1 shows the last 8 rows with no CTA', () => {
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={series}
        bucket={6}
        onBucketChange={() => {}}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
        weekDays={14}
      />
    ))
    const tbody = document.querySelector('tbody')!
    const rows = tbody.querySelectorAll('tr')
    // 56 total / 48 per page = 48 on page 0 + 1 CTA = 49.
    expect(rows.length).toBe(PAGE_SIZE + 1)
    const ctaText = tbody.querySelector('[data-testid="next-page-cta"]')!.textContent
    // Remaining = 56 - 48 = 8.
    expect(ctaText).toMatch(/8 filas restantes|8 rows remaining/i)
  })

  it('clicking the next-CTA replaces the rows with the next page', async () => {
    const user = userEvent.setup()
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={series}
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
    // Page 0: hours 0..47 (labels Hoy 00:00, Hoy 01:00, …). The
    // first <td> per <tr> is the "Cuándo" column with the label.
    const tbody0 = document.querySelector('tbody')!
    const firstLabelPage0 = tbody0.querySelector('tr td:nth-child(1)')?.textContent ?? ''
    expect(firstLabelPage0).toMatch(/00:00|01:00|02:00|03:00/i)

    // Advance to page 1.
    const cta = tbody0.querySelector<HTMLElement>('[data-testid="next-page-cta"]')!
    await user.click(cta)

    // Page 1 should now show the next batch.
    const tbody1 = document.querySelector('tbody')!
    const rows1 = tbody1.querySelectorAll('tr')
    // 48 data + 1 next CTA + 1 previous CTA = 50.
    expect(rows1.length).toBe(PAGE_SIZE + 2)
    // The previous-CTA is now present (page 1 of 7).
    expect(tbody1.querySelector('[data-testid="prev-page-cta"]')).not.toBeNull()
    // Remaining after page 1 = 336 - 96 = 240.
    const ctaText1 = tbody1.querySelector('[data-testid="next-page-cta"]')!.textContent
    expect(ctaText1).toMatch(/240 filas restantes|240 rows remaining/i)
  })

  it('bucket=24 (≤14 rows) renders with no CTA', () => {
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={series}
        fullTimes={fakeTimes(0, HOURS)}
        fullSeries={series}
        startIndex={0}
        bucket={24}
        onBucketChange={() => {}}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={HOURS}
        utcOffsetSeconds={0}
        ensembleMode="wedai"
        weekDays={14}
      />
    ))
    const tbody = document.querySelector('tbody')!
    expect(tbody.querySelectorAll('tr').length).toBe(14)
    expect(tbody.querySelector('[data-testid="next-page-cta"]')).toBeNull()
  })

  it('thead is sticky inside an internal scroll container', () => {
    const { container } = render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={series}
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
    // The wrapper around the <table> has max-height + overflow:auto so
    // sticky headers have a scrolling context. jsdom doesn't paint, but
    // we can still verify the container class.
    const scrollContainer = container.querySelector('.max-h-\\[70vh\\]') as HTMLElement | null
    expect(scrollContainer).not.toBeNull()
    expect(scrollContainer!.className).toMatch(/overflow-auto/i)
    // Sprint 10 / B-10-8: switched back to `border-collapse: collapse`
    // because the previous `border-separate + border-spacing: 0` combo
    // caused column-width drift when the first column was sticky on
    // mobile. Modern browsers (Chrome 91+, Safari 14+) support sticky
    // headers with `border-collapse: collapse` natively.
    const table = scrollContainer!.querySelector('table')!
    expect(table.className).toMatch(/border-collapse/i)
    // B-NEW-5 (2026-07-24): the table defaults to `table-auto` on
    // mobile (no `table-fixed` class). With `table-fixed` every
    // `width: auto` column shared the remaining width equally, which
    // squeezed the 1h/2h/6h columns below readable size on a 360-px
    // phone. Without `table-fixed` each column sizes to the widest
    // CELL in that column, the table is its natural width, and the
    // container's `overflow-x-auto` (set on the parent) takes over
    // when the natural width exceeds the viewport. The first column
    // is still pinned via the CSS-variable width on its <col>, and
    // every data cell has a `min-w-[40px] sm:min-w-[44px]` floor so
    // no single column collapses to nothing.
    //
    // B-NEW-12 (2026-07-25): on >=md (desktop) the table switches
    // to `md:table-fixed` so the explicit-width columns (sticky +
    // marine) keep their size and the remaining `width: auto`
    // basic columns share the rest of the row, filling the
    // container. With `table-auto` on desktop the basic columns
    // auto-sized to ~35-45 px each and the marine columns were
    // 40 px each, leaving an empty band of background on the right
    // (the user reported "sobra espacio por la derecha").
    //
    // B-NEW-17 (2026-07-27): the breakpoint moved from `md:` to
    // `lg:` (>=1024 px). Mobile landscape (768-1023 px) stays on
    // `table-auto` so basic columns size to their content and the
    // now-48-px marine columns fit `27.8°` (~33 px text + 12 px
    // padding = 45 px) without overflowing into the next column.
    // We assert the desktop class is present and the BASE class
    // is absent (so jsdom doesn't accidentally match the prefixed
    // one).
    expect(table.className).toMatch(/\blg:table-fixed\b/)
    // Sprint 14: `table-fixed` is now also on the base class
    // (not just lg:) so the column widths are explicit in
    // portrait, where the column filter plus fixed widths plus
    // ellipsis is what guarantees the user never has to scroll
    // horizontally.
    expect(table.className).toMatch(/(^|\s)table-fixed(\s|$)/)
    // The table now declares an explicit <colgroup> with the first
    // column pinned to 64 px so the sticky column has a stable width.
    const colgroup = table.querySelector('colgroup')!
    expect(colgroup).not.toBeNull()
    const firstCol = colgroup.querySelector('col')!
    // B-NEW-4: the first-column width is now a CSS custom property
    // (--when-col-w) so the same `<col>` works on both phone and
    // desktop without relying on Tailwind responsive variants inside
    // a `<col>` element (which has inconsistent support). The CSS
    // variable is defined in app/globals.css with a media query.
    expect(firstCol.getAttribute('style')).toMatch(/var\(--when-col-w/i)
    expect(firstCol.getAttribute('style')).toMatch(/64px/i)
    // Sprint 10 / B-NEW-2: every <col> must carry the same `hideClass`
    // as its <th>/<td> so `display: none` collapses the column.
    // Under `table-auto` the hideClass still matters: without it,
    // a hidden <th>/<td> would leave a gap in the table because the
    // <col> itself still claims a slot. We keep the same DOM rule
    // (col matches thead) and just verify it here.
    const allCols = Array.from(colgroup.querySelectorAll('col'))
    for (const col of allCols) {
      const id = col.getAttribute('data-col-id')
      if (!id) continue
      const th = table.querySelector(`th[data-col-id="${id}"]`)
      if (th && th.className.includes('hidden')) {
        expect(col.className).toMatch(/hidden/)
      }
    }
    // The thead itself carries the sticky top-0 utility.
    const thead = table.querySelector('thead')!
    expect(thead.className).toMatch(/sticky/i)
    expect(thead.className).toMatch(/top-0/i)
  })

  it('cells use contain:layout_style_paint for paint isolation', () => {
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={series}
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
    const cell = document.querySelector('tbody tr td:nth-child(2)') as HTMLElement | null
    expect(cell).not.toBeNull()
    expect(cell!.className).toMatch(/contain.*layout_style_paint|contain:\s*layout\s+style\s+paint/i)
  })
})

/**
 * Sprint 10 / B-NEW-2 — mobile collapsed-table bug.
 *
 * On mobile portrait the table was rendered with `table-fixed` and
 * `<col>` elements that didn't carry the same `hideClass` as the
 * `<th>`/`<td>`. Because `table-fixed` derives column widths from the
 * `<colgroup>`, columns hidden on mobile (min, max, clouds, gusts,
 * pressure, dewpoint, visibility) still claimed a slice of the
 * container width, leaving the visible columns clustered on the left
 * with empty space on the right. The fix is to apply `hideClass` to
 * the `<col>` so `display: none` collapses the column entirely.
 */
describe('InsightsTable — B-NEW-2 hideClass on <col> prevents left-collapse', () => {
  const HOURS = 24 * 14
  const series: SeriesLike = {
    ...rampSeries('gfs_global', HOURS, 10, 0),
    ...rampSeries('ecmwf_ifs', HOURS, 20, 0),
  }

  it('every <col> carries the same hideClass as its <th>', () => {
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={series}
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
    const table = document.querySelector('table')!
    const cols = Array.from(table.querySelectorAll('colgroup col'))
    const ths = Array.from(table.querySelectorAll('thead th[data-col-id]'))
    // Every <th data-col-id> must have a matching <col data-col-id>.
    for (const th of ths) {
      const id = th.getAttribute('data-col-id')
      expect(id).not.toBeNull()
      const col = cols.find(c => c.getAttribute('data-col-id') === id)
      expect(col, `col for ${id}`).toBeTruthy()
      // If the <th> declares `hidden`, the <col> must too — otherwise
      // the hidden column still allocates width under `table-fixed`.
      const thHidden = th.className.includes('hidden')
      const colHidden = (col as Element).className.includes('hidden')
      expect(colHidden, `col for ${id} should mirror <th> hidden state`).toBe(thHidden)
    }
  })

  it('hidden columns (min, max, clouds, gusts, pressure, dewpoint, visibility) are collapsed via <col>', () => {
    render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={['gfs_global', 'ecmwf_ifs']}
        times={fakeTimes(0, HOURS)}
        series={series}
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
    const hiddenIds = ['min', 'max', 'clouds', 'gusts', 'pressure', 'dewpoint', 'visibility']
    const table = document.querySelector('table')!
    for (const id of hiddenIds) {
      const col = table.querySelector(`colgroup col[data-col-id="${id}"]`)
      expect(col, `col[${id}] should exist`).toBeTruthy()
      expect((col as Element).className).toMatch(/hidden/)
    }
  })
})

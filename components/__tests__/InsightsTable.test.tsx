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
 * Sprint 10 / B-10-6 — full-horizon rendering for bucket=1.
 *
 * The previous implementation capped bucket=1 at 96 h (4 days) because
 * rendering 336 cells was expensive on mobile. With `content-visibility:
 * auto` + `contain-intrinsic-size` the browser skips off-screen rows
 * natively, so we expose the full horizon the user requested.
 */
describe('InsightsTable — full-horizon rendering (Sprint 10)', () => {
  const HOURS = 24 * 14 // 14 days
  const series: SeriesLike = {
    ...rampSeries('gfs_global', HOURS, 10, 0),
    ...rampSeries('ecmwf_ifs', HOURS, 20, 0),
  }

  it('bucket=1 generates one row per hour across the full 14-day horizon', () => {
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
    // The full horizon is now rendered (no pagination); off-screen
    // rows are skipped by the browser via content-visibility.
    const tbody = document.querySelector('tbody')!
    const rows = tbody.querySelectorAll('tr').length
    expect(rows).toBe(HOURS) // 336 = 14 days × 24 h
  })

  it('bucket=2 generates one row per 2 hours across the full 14-day horizon', () => {
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
    const rows = tbody.querySelectorAll('tr').length
    // 336 / 2 = 168 rows.
    expect(rows).toBe(168)
  })

  it('rows use content-visibility: auto so off-screen rendering is skipped', () => {
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
    const firstRow = document.querySelector('tbody tr') as HTMLElement | null
    expect(firstRow).not.toBeNull()
    // jsdom doesn't actually skip rendering, but it must propagate
    // the inline style to the DOM node so the browser picks it up
    // in production.
    const style = firstRow!.getAttribute('style') ?? ''
    expect(style).toMatch(/content-visibility:\s*auto/i)
    expect(style).toMatch(/contain-intrinsic-size:\s*auto\s+28px/i)
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
    // Pick any non-Cuando cell and assert the containment class is
    // present (we don't assert exact wording so future Tailwind
    // upgrades don't break the test).
    const cell = document.querySelector('tbody tr td:nth-child(2)') as HTMLElement | null
    expect(cell).not.toBeNull()
    expect(cell!.className).toMatch(/contain.*layout_style_paint|contain:\s*layout\s+style\s+paint/i)
  })
})

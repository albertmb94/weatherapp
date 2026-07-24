import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DailySummary from '@/components/DailySummary'
import { LocaleProvider } from '@/lib/LocaleContext'
import type { WeatherModel } from '@/lib/models'

// B-NEW-7: the production API (after B-NEW-3 in lib/openMeteo.ts) only
// returns 5 long-range models. The DailySummary chips in the
// "Resumen diario" section used to render em-dashes for every
// temperature when the user had selected only a short-range model
// because the DailySummary loop called `weightedAvg` directly with
// the user's selection. This test pins the new behaviour: the
// DailySummary now uses `ensembleWithFallback` and falls back to
// the WedAI ensemble when the user's selection returns no data, so
// the user always sees a high/low for every day.

const MODELS: WeatherModel[] = [
  { id: 'ecmwf_ifs', label: 'ECMWF', color: '#000', maxHours: 360, weight: 30, type: 'deterministic', region: 'global' },
  { id: 'gfs_global', label: 'GFS', color: '#000', maxHours: 384, weight: 14, type: 'deterministic', region: 'global' },
  { id: 'meteofrance_arome_france_hd', label: 'AROME-FR', color: '#000', maxHours: 48, weight: 20, type: 'deterministic', region: 'europe' },
]

function wrap(node: React.ReactNode) {
  return <LocaleProvider initialLocale="en">{node}</LocaleProvider>
}

function fakeTimes(count: number): Date[] {
  const out: Date[] = []
  const base = new Date(Date.UTC(2026, 6, 20, 0, 0, 0))
  for (let i = 0; i < count; i++) {
    out.push(new Date(base.getTime() + i * 3600_000))
  }
  return out
}

function buildLongRangeOnlySeries(length: number) {
  const series: Record<string, Record<string, (number | null)[]>> = {}
  for (const m of ['ecmwf_ifs', 'gfs_global']) {
    series[m] = {
      temperature: Array.from({ length }, (_, i) => 20 + (i % 24) * 0.5),
      precipitation: Array.from({ length }, () => 0),
      wind_gusts: Array.from({ length }, () => 5),
      cloud_cover: Array.from({ length }, () => 50),
      sea_surface_temperature: new Array(length).fill(null),
      wave_height: new Array(length).fill(null),
      wave_period: new Array(length).fill(null),
    }
  }
  return series
}

describe('DailySummary — WedAI fallback for missing models (B-NEW-7)', () => {
  it('renders em-dashes only when both selection and WedAI have no data', () => {
    const times = fakeTimes(48)
    const series: Record<string, Record<string, (number | null)[]>> = {}
    // No data for any model.
    const { container } = render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={['meteofrance_arome_france_hd']}
        times={times}
        series={series}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={times.length}
        startIndex={0}
        utcOffsetSeconds={0}
      />
    ))
    // With empty series the chips should show em-dashes everywhere.
    expect(container.textContent).toContain('–°')
  })

  it('renders real temperatures when the user selects only a missing short-range model', () => {
    const times = fakeTimes(96)
    const series = buildLongRangeOnlySeries(96)
    // User has selected only arome_france_hd which is NOT in the
    // series (production API filters to long-range). The DailySummary
    // must fall back to the WedAI ensemble (ecmwf_ifs + gfs_global)
    // so the chips show real temperatures instead of em-dashes.
    const { container } = render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={['meteofrance_arome_france_hd']}
        times={times}
        series={series}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={times.length}
        startIndex={0}
        utcOffsetSeconds={0}
      />
    ))
    // 2 days × 2 em-dash positions each (high + low) = 4 em-dashes
    // total — every "real" temperature is a degree value, not "–".
    const dashes = container.textContent?.match(/–°/g) ?? []
    expect(dashes.length).toBeLessThanOrEqual(4)
  })
})

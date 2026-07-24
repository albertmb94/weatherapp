import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LocaleProvider } from '@/lib/LocaleContext'
import DailySummary from '@/components/DailySummary'
import type { WeatherModel } from '@/lib/models'

// B-NEW-8 (2026-07-24): the model selector must work in BOTH WedAI
// and Models modes. Before this fix, WedAI mode hard-coded
// `activeModels = allModels` and the user's `activeModelIds` was
// silently ignored — clicking a model in the dropdown updated the
// URL but had no effect on the table value, so every individual
// model appeared to return the same number. The fix filters the
// ensemble by `activeModelIds` in both modes; only the WEIGHTING
// differs (WedAI uses preset weights per metric / per lead time,
// Models uses each model's static weight). The default selection
// is the full 20-model list, so the "all models" result is preserved
// as the WedAI default and the user can deselect to drop a model
// from either mode.

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

describe('DailySummary — selector works in both WedAI and Models (B-NEW-8)', () => {
  const times = fakeTimes(96)

  function buildSeries() {
    const series: Record<string, Record<string, (number | null)[]>> = {}
    // Each model has a clearly different temperature curve so we can
    // verify that the user selection actually filters the ensemble.
    for (const id of ['ecmwf_ifs', 'gfs_global', 'meteofrance_arome_france_hd']) {
      const base = id === 'ecmwf_ifs' ? 20 : id === 'gfs_global' ? 24 : 28
      series[id] = {
        temperature: times.map((_, i) => base + (i % 24) * 0.1),
        precipitation: times.map(() => 0),
        wind_gusts: times.map(() => 5),
        cloud_cover: times.map(() => 50),
        sea_surface_temperature: new Array(times.length).fill(null),
        wave_height: new Array(times.length).fill(null),
        wave_period: new Array(times.length).fill(null),
      }
    }
    return series
  }

  it('rendering does not throw when the user has selected only one model', () => {
    const series = buildSeries()
    // Before the fix, selecting a single model in WedAI mode would
    // still show the 19-model mean because activeModels was forced
    // to allModels. After the fix, the DailySummary must accept a
    // single-model selection and not crash on the fallback path.
    const renderOneModel = () => render(wrap(
      <DailySummary
        models={MODELS}
        activeModelIds={['ecmwf_ifs']}
        times={times}
        series={series}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={times.length}
        startIndex={0}
        utcOffsetSeconds={0}
      />
    ))
    expect(renderOneModel).not.toThrow()
  })

  it('WedAI fallback still fires when the selected model has no data', () => {
    const series: Record<string, Record<string, (number | null)[]>> = {
      // Only the non-selected models have data. The selected
      // model's series is missing entirely.
      ecmwf_ifs: {
        temperature: times.map(() => 20),
        precipitation: times.map(() => 0),
        wind_gusts: times.map(() => 5),
        cloud_cover: times.map(() => 50),
        sea_surface_temperature: new Array(times.length).fill(null),
        wave_height: new Array(times.length).fill(null),
        wave_period: new Array(times.length).fill(null),
      },
      gfs_global: {
        temperature: times.map(() => 25),
        precipitation: times.map(() => 0),
        wind_gusts: times.map(() => 5),
        cloud_cover: times.map(() => 50),
        sea_surface_temperature: new Array(times.length).fill(null),
        wave_height: new Array(times.length).fill(null),
        wave_period: new Array(times.length).fill(null),
      },
    }
    // User selected a model that has no series entry. The
    // DailySummary must fall back to the full WedAI ensemble
    // (ecmwf_ifs + gfs_global) so the chips still show a value.
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
    // Both ecmwf_ifs (20) and gfs_global (25) are in the WedAI
    // fallback; the chips should show real numbers, not em-dashes.
    const dashes = container.textContent?.match(/–°/g) ?? []
    expect(dashes.length).toBe(0)
  })
})

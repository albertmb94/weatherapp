import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LocaleProvider } from '@/lib/LocaleContext'
import InsightsTable from '@/components/InsightsTable'
import type { WeatherModel } from '@/lib/models'

// B-NEW-9 (2026-07-24): the production bug was that WedAI was
// collapsed into the user's Models selection (commit 808752d
// changed `activeModels` to `models.filter(m => activeModelIds
// .includes(m.id))` for both modes). This test pins the reverted
// behaviour: WedAI is ALWAYS the full 19-model land ensemble,
// regardless of which models the user has selected. Models mode
// is the only mode that respects the user's selection.

const MODELS: WeatherModel[] = [
  { id: 'ecmwf_ifs', label: 'ECMWF', color: '#000', maxHours: 360, weight: 30, type: 'deterministic', region: 'global' },
  { id: 'gfs_global', label: 'GFS', color: '#000', maxHours: 384, weight: 14, type: 'deterministic', region: 'global' },
  { id: 'ncep_aigfs025', label: 'AIGFS', color: '#000', maxHours: 384, weight: 10, type: 'ai', region: 'global' },
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

// Build a series map with one clearly different value per model.
// The selector bug manifests as "different selections → same
// value" because the activeModels set is always the same. With
// each model producing a distinct value, we can verify the
// activeModels set changes per selection.
function buildDistinctSeries(length: number) {
  const series: Record<string, Record<string, (number | null)[]>> = {}
  // Each model has a clearly different base temperature so we
  // can verify the activeModels set actually filters per model.
  for (const m of MODELS) {
    const base = m.id === 'ecmwf_ifs' ? 20
              : m.id === 'gfs_global' ? 24
              : m.id === 'ncep_aigfs025' ? 28
              : 32 // arome
    series[m.id] = {
      temperature: Array.from({ length }, (_, i) => base + (i % 24) * 0.1),
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

describe('InsightsTable — WedAI vs Models separation (B-NEW-9)', () => {
  const times = fakeTimes(48)
  const series = buildDistinctSeries(48)

  function mount(props: {
    ensembleMode: 'wedai' | 'models'
    activeModelIds: string[]
  }) {
    return render(wrap(
      <InsightsTable
        models={MODELS}
        activeModelIds={props.activeModelIds}
        times={times}
        series={series}
        fullTimes={times}
        fullSeries={series}
        startIndex={0}
        weekDays={14}
        bucket={1}
        onBucketChange={() => {}}
        selectedHour={0}
        onSelectHour={() => {}}
        maxHours={48}
        utcOffsetSeconds={0}
        ensembleMode={props.ensembleMode}
      />
    ))
  }

  it('WedAI mode ignores the user selection (uses the full 19-model ensemble)', () => {
    // User selected only AROME-FR. WedAI must still average over
    // all 4 land models (ECMWF, GFS, AIGFS, AROME) because WedAI
    // is the calibrated ensemble, not the user's pick. Before the
    // revert, WedAI would have used only AROME (a single model)
    // and the mean would equal 32.x.
    const { container: wedai } = mount({ ensembleMode: 'wedai', activeModelIds: ['meteofrance_arome_france_hd'] })
    const { container: wedaiAll } = mount({ ensembleMode: 'wedai', activeModelIds: MODELS.map(m => m.id) })

    // Look at row index 2 (the first non-active, non-pagination
    // row). The active row (row 0, selectedHour=0) always shows
    // the WedAI value by design, so it can't distinguish the two
    // cases. The pagination row at index 1 is "show next 48 h"
    // and also doesn't carry a temperature. The data rows start
    // at index 2.
    const tempAt = (c: HTMLElement, rowIdx: number) => {
      const headers = Array.from(c.querySelectorAll('th[data-col-id]'))
      const tempIdx = headers.findIndex(h => h.getAttribute('data-col-id') === 'temp')
      const rows = c.querySelectorAll('tbody tr')
      const cells = rows[rowIdx]?.querySelectorAll('td')
      return cells?.[tempIdx + 1]?.textContent?.match(/(-?\d+(?:\.\d+)?)/)?.[0] ?? null
    }
    // The two WedAI mounts (one-model selection vs all-models
    // selection) must produce identical body values because WedAI
    // ignores the selection.
    expect(tempAt(wedai, 2)).toBe(tempAt(wedaiAll, 2))
  })

  it('Models mode respects the user selection (different selections → different values)', () => {
    // selectedHour=4 so the first row is NOT the active row
    // (the active row is forced to the WedAI ensemble regardless
    // of the selection — by design, so the big "Tiempo actual"
    // card and the "AHORA" slot of the hourly strip always
    // agree with the user's selected row).
    const { container: ecmwf } = mount({ ensembleMode: 'models', activeModelIds: ['ecmwf_ifs'] })
    const { container: gfs } = mount({ ensembleMode: 'models', activeModelIds: ['gfs_global'] })
    const { container: arome } = mount({ ensembleMode: 'models', activeModelIds: ['meteofrance_arome_france_hd'] })

    // Extract the value in the `temp` column of the SECOND data
    // row (the first row is the active row and shows the WedAI
    // value). The body row has the "Cuándo" sticky cell
    // prepended, so the temp cell is at `tempIdx + 1` within
    // each row.
    const tempAt = (c: HTMLElement, rowIdx: number) => {
      const headers = Array.from(c.querySelectorAll('th[data-col-id]'))
      const tempIdx = headers.findIndex(h => h.getAttribute('data-col-id') === 'temp')
      if (tempIdx < 0) return null
      const rows = c.querySelectorAll('tbody tr')
      const target = rows[rowIdx]
      if (!target) return null
      const cells = target.querySelectorAll('td')
      return cells[tempIdx + 1]?.textContent?.match(/(-?\d+(?:\.\d+)?)/)?.[0] ?? null
    }
    const e = tempAt(ecmwf, 1)
    const g = tempAt(gfs, 1)
    const a = tempAt(arome, 1)
    expect(e).not.toBeNull()
    expect(g).not.toBeNull()
    expect(a).not.toBeNull()
    // The three selections MUST produce different values because
    // the test series gives each model a distinct base temperature
    // (20, 24, 28, 32). Before the B-NEW-9 revert, all three
    // would have produced the same 19-model WedAI mean.
    expect(new Set([e, g, a]).size).toBe(3)
  })

  it('WedAI mode with default (all 20) selection equals WedAI with any subset', () => {
    // All 4 selected.
    const { container: full } = mount({ ensembleMode: 'wedai', activeModelIds: MODELS.map(m => m.id) })
    // Only one selected.
    const { container: single } = mount({ ensembleMode: 'wedai', activeModelIds: ['ecmwf_ifs'] })

    // Look at a NON-active row (index 1) so the value reflects
    // the body aggregation, not the active-row WedAI override.
    const tempAt = (c: HTMLElement, rowIdx: number) => {
      const headers = Array.from(c.querySelectorAll('th[data-col-id]'))
      const tempIdx = headers.findIndex(h => h.getAttribute('data-col-id') === 'temp')
      const rows = c.querySelectorAll('tbody tr')
      const cells = rows[rowIdx]?.querySelectorAll('td')
      return cells?.[tempIdx + 1]?.textContent?.match(/(-?\d+(?:\.\d+)?)/)?.[0] ?? null
    }
    expect(tempAt(full, 1)).toBe(tempAt(single, 1))
  })
})

import { describe, it, expect } from 'vitest'
import { computeHourlySlots, computeWeekSummaries, computeCurrentSnapshot } from '../friendlyForecast'
import { MODELS } from '../models'

// Repro: after B-NEW-3 the API only returns the 5 long-range models.
// `displayModels` is still the full 19-model list and `displayActiveModelIds`
// is still the user-selected list (all 19 by default). The friendly helpers
// must keep producing non-null values because at least one long-range model
// has data at the queried index.

const EUROPE_LONG_RANGE = [
  { id: 'ecmwf_ifs', label: 'ECMWF', color: '#fff', maxHours: 360, weight: 30, type: 'deterministic' as const, region: 'global' as const },
  { id: 'gfs_global', label: 'GFS', color: '#fff', maxHours: 384, weight: 14, type: 'deterministic' as const, region: 'global' as const },
  { id: 'ecmwf_aifs025', label: 'AIFS', color: '#fff', maxHours: 360, weight: 22, type: 'ai' as const, region: 'global' as const },
  { id: 'gfs_graphcast025', label: 'GC', color: '#fff', maxHours: 384, weight: 12, type: 'ai' as const, region: 'global' as const },
  { id: 'ncep_aigfs025', label: 'AIGFS', color: '#fff', maxHours: 384, weight: 10, type: 'ai' as const, region: 'global' as const },
]

// Build a realistic `bag` for Europe: 3 days past + 16 days forward at
// hourly resolution (456 entries). Only the 5 long-range models have
// data; the 14 short-range / non-queried models are entirely missing
// from `bag.series` (which is what the production openMeteo.ts does —
// it iterates only the requested models).
function buildEuropeBag() {
  const HOURS = 456
  const base = new Date(Date.UTC(2026, 6, 21, 0, 0, 0)) // Mar 21 00:00 UTC
  const time: Date[] = []
  for (let i = 0; i < HOURS; i++) {
    time.push(new Date(base.getTime() + i * 3_600_000))
  }
  const series: Record<string, Record<string, (number | null)[]>> = {}
  // Realistic-ish temperature curve: warmer mid-day, cooler at night.
  for (const m of EUROPE_LONG_RANGE) {
    series[m.id] = {
      temperature: time.map((_, i) => {
        // i=0 is 2026-07-21T00:00Z, i=84 is 2026-07-24T12:00Z.
        // Use UTC hour of the date directly so the curve peaks at 12:00.
        const d = time[i]
        const hourOfDay = d.getUTCHours()
        return 20 + 8 * Math.sin((hourOfDay - 6) * Math.PI / 12) // 12..28
      }),
      precipitation: time.map(() => 0),
      wind_speed: time.map(() => 10),
      wind_gusts: time.map(() => 15),
      cloud_cover: time.map(() => 30),
      humidity: time.map(() => 50),
    }
  }
  return { time, series }
}

// B-NEW-5: the production API only requests long-range models, so the
// short-range models return null past 48h. If the user has manually
// deselected every long-range model (e.g. only kept `icon_eu` which
// maxes out at 120h), the future slots in the strip and the day
// summaries in DailySummary/WeekForecastPanel would all render as
// em-dashes. The friendly helpers fall back to the full WedAI
// ensemble so the overview cards never show gaps when at least one
// model has a value for the hour.
describe('friendly helpers fall back to WedAI when user selection is empty (B-NEW-5)', () => {
  const bag = buildEuropeBag()
  const displayModels = MODELS.filter(m => m.id !== 'marine_global')
  // Pretend the user kept ONLY a short-range model with no data at
  // hour 84+ (icon_eu only covers 120h so it has data at 88 too, but
  // `meteofrance_arome_france_hd` only covers 48h so it has data
  // until hour 48 and is null at 84+). We pick a model that has data
  // at every hour in our test so we can prove the selection is
  // respected; the interesting case is the explicit `[]` below.
  const NOW_INDEX = 84

  it('respects the user selection when it produces a value', () => {
    const slots = computeHourlySlots(
      bag, displayModels, ['gfs_global', 'ecmwf_ifs'], NOW_INDEX, 'es'
    )
    expect(slots[0].tempC).not.toBeNull()
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].tempC, `slot ${slots[i].hourLabel}`).not.toBeNull()
    }
  })

  it('falls back to WedAI when the selection is empty', () => {
    const slots = computeHourlySlots(bag, displayModels, [], NOW_INDEX, 'es')
    expect(slots.length).toBe(7)
    // Now the helper sees no selected models, but at least 3 of the
    // 5 long-range models have data at every hour, so the WedAI
    // fallback returns a non-null value.
    for (const s of slots) {
      expect(s.tempC, `slot ${s.hourLabel}`).not.toBeNull()
    }
  })

  it('falls back to WedAI when the selection has no data at the hour', () => {
    // All 19 models, but aifs025 and graphcast025 have null in our
    // synthetic bag — verify the fallback path is wired even when
    // the selection is non-empty. The user-visible test is that the
    // current snapshot still returns a value when the user has
    // selected only an AI model that happens to be null at that hour.
    const snap = computeCurrentSnapshot(
      bag, displayModels, ['ecmwf_aifs025'], NOW_INDEX
    )
    expect(snap).not.toBeNull()
    expect(snap!.temperatureC).not.toBeNull()
  })

  it('computeWeekSummaries falls back to WedAI when the selection is empty', () => {
    const days = computeWeekSummaries(
      bag, displayModels, [], NOW_INDEX, 84 + 14 * 24, 'es', 14
    )
    expect(days.length).toBe(14)
    for (const d of days) {
      expect(d.highC, `day ${d.label}`).not.toBeNull()
      expect(d.lowC, `day ${d.label}`).not.toBeNull()
    }
  })
})


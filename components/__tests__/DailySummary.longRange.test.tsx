import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DailySummary from '@/components/DailySummary'
import { LocaleProvider } from '@/lib/LocaleContext'
import { MODELS } from '@/lib/models'

// The 10 models that the production `fetchForecast` actually sends to
// Open-Meteo. The user has 21 land models selected by default, so the
// other 11 land models have `series[modelId] === undefined` — getMetric
// returns null for them, but the 3 long-range globals (ecmwf_ifs,
// icon_global, gfs_global) must still produce a valid ensemble for all
// 14 days even when the regional models all expire.
const SENT_MODEL_IDS = [
  'meteofrance_arome_france_hd',
  'dwd_icon_d2',
  'dmi_harmonie_arome_europe',
  'meteofrance_arome_france',
  'knmi_harmonie_arome_europe',
  'icon_eu',
  'meteofrance_arpege_europe',
  'ecmwf_ifs',
  'icon_global',
  'gfs_global',
]

// Build a 456-hour (19-day) temperature grid that mirrors Open-Meteo's
// real horizons as observed in production (see scripts/debug-daily-summary):
// regional models expire at their documented maxHours, but the global
// models usually return data for the full 384h forecast window because
// Open-Meteo extends the effective horizon even past the documented
// maxHours (it's a soft cap, not a hard cut). We give the globals a
// fully-populated 456 h grid so the long-range chips stay lit.
function buildSeries(count: number) {
  const series: Record<string, Record<string, (number | null)[]>> = {}
  const horizons: Record<string, number> = {
    meteofrance_arome_france_hd: 48,
    dwd_icon_d2: 48,
    dmi_harmonie_arome_europe: 60,
    meteofrance_arome_france: 96,
    knmi_harmonie_arome_europe: 60,
    icon_eu: 120,
    meteofrance_arpege_europe: 96,
    ecmwf_ifs: count,
    icon_global: 240,
    gfs_global: count,
  }
  for (const id of SENT_MODEL_IDS) {
    const temp = new Array<number | null>(count).fill(null)
    const horizon = Math.min(horizons[id], count)
    for (let i = 0; i < horizon; i++) {
      temp[i] = 25 + 6 * Math.sin((i / 24) * 2 * Math.PI)
    }
    series[id] = {
      temperature: temp,
      precipitation: new Array(count).fill(0),
      wind_gusts: new Array(count).fill(0),
      cloud_cover: new Array(count).fill(50),
    }
  }
  return series
}

function buildTimes(startIndex: number, count: number): Date[] {
  const out: Date[] = []
  const base = new Date(Date.UTC(2026, 6, 21, 0, 0, 0))
  for (let i = 0; i < count; i++) {
    out.push(new Date(base.getTime() + i * 3600_000))
  }
  return out
}

describe('DailySummary — 14-day coverage (B-NEW-1)', () => {
  it('all 14 day chips render with valid tMin/tMax in WedAI mode', () => {
    const count = 456 // 19 days × 24 h
    const times = buildTimes(0, count)
    const series = buildSeries(count)
    const startIndex = 72 // 3 days in (mid-data start)
    const weekDays = 14
    const rem = startIndex % 24
    const toMidnight = rem === 0 ? 24 : 24 - rem
    const maxHours = Math.min(times.length, startIndex + toMidnight + (weekDays - 1) * 24)
    const activeModelIds = MODELS.map(m => m.id).filter(id => id !== 'marine_global')

    render(
      <LocaleProvider locale="es">
        <DailySummary
          models={MODELS}
          activeModelIds={activeModelIds}
          times={times}
          series={series}
          selectedHour={startIndex}
          onSelectHour={() => {}}
          maxHours={maxHours}
          utcOffsetSeconds={2 * 3600}
          startIndex={startIndex}
        />
      </LocaleProvider>
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(14)
    for (const btn of buttons) {
      expect(btn.textContent).not.toMatch(/–°/)
    }
  })

  it('still populates the 14 chips when startIndex is mid-day (startIndex=86)', () => {
    const count = 456
    const times = buildTimes(0, count)
    const series = buildSeries(count)
    const startIndex = 86 // 3 days + 14 h → "Sáb 26 14:00"
    const weekDays = 14
    const rem = startIndex % 24
    const toMidnight = rem === 0 ? 24 : 24 - rem
    const maxHours = Math.min(times.length, startIndex + toMidnight + (weekDays - 1) * 24)
    const activeModelIds = MODELS.map(m => m.id).filter(id => id !== 'marine_global')

    render(
      <LocaleProvider locale="es">
        <DailySummary
          models={MODELS}
          activeModelIds={activeModelIds}
          times={times}
          series={series}
          selectedHour={startIndex}
          onSelectHour={() => {}}
          maxHours={maxHours}
          utcOffsetSeconds={2 * 3600}
          startIndex={startIndex}
        />
      </LocaleProvider>
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(14)
    for (const btn of buttons) {
      expect(btn.textContent).not.toMatch(/–°/)
    }
  })
})

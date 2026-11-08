import { describe, expect, it, vi, afterEach } from 'vitest'
import { archiveTime, shiftArchiveHours } from '../archiveTime'
import { calibrateBucket, fitSkill, type TimedSample } from '../temporalCalibration'
import { xemaReadingsToRows } from '../fetchStations'
import { fetchPreviousRuns } from '../fetchPreviousRuns'
import { fetchERA5Observations } from '../fetchERA5'

afterEach(() => vi.unstubAllGlobals())

describe('UTC verification archive', () => {
  it('keeps distinct instants across the repeated Madrid autumn hour', () => {
    const first = archiveTime('2026-10-25T02:00+02:00')
    const second = archiveTime('2026-10-25T02:00+01:00')
    expect(Date.parse(second) - Date.parse(first)).toBe(3600_000)
    expect(shiftArchiveHours(second, -24)).toBe('2026-10-24T01:00:00.000Z')
    expect(archiveTime(1792886400)).toBe(first)
  })

  it('fetches identical UTC valid hours and keeps model gaps instead of substituting another model', async () => {
    const urls: URL[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(new URL(url))
      const forecast = url.includes('previous-runs')
      return new Response(JSON.stringify({ hourly: { time: [1792886400, 1792890000],
        ...(forecast ? { temperature_2m_previous_day1_a: [10, null], temperature_2m: [999, 999] }
          : { temperature_2m: [12, 13] }),
      } }), { status: 200 })
    }))
    const location = { name: 'Test', lat: 41, lon: 2, terrain: 'coastal' as const, country: 'ES' }
    const forecasts = await fetchPreviousRuns(location, '2026-10-25', '2026-10-25', undefined, { metrics: ['temperature'], modelIds: ['a', 'b'] })
    const obs = await fetchERA5Observations(location, '2026-10-25', '2026-10-25', undefined, ['temperature'])
    expect(urls.every(u => u.searchParams.get('timezone') === 'GMT' && u.searchParams.get('timeformat') === 'unixtime')).toBe(true)
    expect(forecasts).toHaveLength(1)
    expect(forecasts[0].valid_time).toBe(obs[0].valid_time)
    expect(Date.parse(forecasts[0].valid_time) - Date.parse(forecasts[0].init_time)).toBe(24 * 3600_000)
    expect(forecasts[0].predicted_value).toBe(10)
  })

  it('sums complete forward-labelled half-hours into the preceding hour at its end', () => {
    const meta = new Map([['A', { name: 'Test', lat: 41, lon: 2 }]])
    const rows = xemaReadingsToRows(meta, { precipitation: new Map([['A', [
      { data: '2026-10-25T00:00Z', valor: 1, baseHoraria: 'SH', estat: 'V' },
      { data: '2026-10-25T00:30Z', valor: 2, baseHoraria: 'SH', estat: 'V' },
      { data: '2026-10-25T01:00Z', valor: 8, baseHoraria: 'SH', estat: 'V' },
      { data: '2026-10-25T01:30Z', valor: 9, baseHoraria: 'SH', estat: 'I' },
    ]]]) })
    expect(rows).toHaveLength(1)
    expect(rows[0].valid_time).toBe('2026-10-25T01:00:00.000Z')
    expect(rows[0].observed_value).toBe(3)
  })
})

describe('chronological calibration', () => {
  const samples: TimedSample[] = Array.from({ length: 200 }, (_, i) => ({
    time: i < 100 ? '2026-09-01T00:00Z' : '2026-09-02T00:00Z', location: 'A',
    observed: 10, byModel: { good: 10, medium: 12, bad: 15 },
  }))
  it('learns measured skill without architectural labels', () => {
    const w = fitSkill(samples, 1)
    expect(w.good).toBeGreaterThan(w.medium)
    expect(w.medium).toBeGreaterThan(w.bad)
    expect(Object.values(w).reduce((s, v) => s + v, 0)).toBeCloseTo(1)
  })
  it('requires separate fitting and validation dates', () => {
    expect(() => calibrateBucket(samples, '2026-08-01', { good: 1 })).toThrow()
    expect(() => calibrateBucket(samples, '2026-10-01', { good: 1 })).toThrow()
  })
})

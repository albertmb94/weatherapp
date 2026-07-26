/**
 * Regression tests for S11 — extracted row builder (`buildInsightRows`).
 *
 * The previous incarnation lived inside `InsightsTable.tsx`. We now
 * exercise it directly: WedAI mode, Models mode, the per-metric
 * aggregation logic, and the cross-bucket label helper.
 */

import { describe, expect, it } from 'vitest'
import { buildInsightRows, bucketLabel } from '../insightRowBuilder'
import { MODELS } from '../models'

const MODELS_FIXTURE = MODELS

function makeTimes(count: number): Date[] {
  const out: Date[] = []
  const base = Date.UTC(2026, 6, 1, 0, 0, 0) // 2026-07-01 00:00 UTC
  for (let i = 0; i < count; i++) {
    out.push(new Date(base + i * 3_600_000))
  }
  return out
}

function makeSeries(modelIds: string[], metric: string, values: (number | null)[]): Record<string, Record<string, (number | null)[]>> {
  const series: Record<string, Record<string, (number | null)[]>> = {}
  for (const id of modelIds) {
    series[id] = { [metric]: [...values] } as Record<string, (number | null)[]>
  }
  return series
}

describe('buildInsightRows — WedAI mode', () => {
  it('always aggregates from the full land-model set, regardless of activeModelIds', () => {
    const times = makeTimes(4)
    const series = makeSeries(['ecmwf_ifs', 'icon_global'], 'temperature', [10, 11, 12, 13])
    const rows = buildInsightRows({
      models: MODELS_FIXTURE,
      activeModelIds: [],
      times,
      series,
      bucket: 1,
      maxHours: 24,
      utcOffsetSeconds: 7200,
      selectedHour: 0,
      currentHourMode: 'wedai',
      ensembleMode: 'wedai',
      nowMs: times[0].getTime(),
      labelFn: bucketLabel,
      locale: 'es',
    })
    // WedAI mode ignores the user selection — the rows still
    // aggregate from the 19 land models. The series for the
    // contributing models exists, so we get one row per hour.
    expect(rows.length).toBe(4)
    expect(rows.every(r => r.tempMean === null || Number.isFinite(r.tempMean))).toBe(true)
  })
})

describe('buildInsightRows — bucket=1, hour precision', () => {
  it('aligns rows to wall-clock hours and computes tempMean from the active models', () => {
    const times = makeTimes(6)
    const series = makeSeries(['ecmwf_ifs', 'icon_global'], 'temperature', [10, 11, 12, 13, 14, 15])
    const rows = buildInsightRows({
      models: MODELS_FIXTURE,
      activeModelIds: ['ecmwf_ifs', 'icon_global'],
      times,
      series,
      bucket: 1,
      maxHours: 24,
      utcOffsetSeconds: 7200,
      selectedHour: 0,
      currentHourMode: 'wedai',
      ensembleMode: 'models',
      nowMs: times[0].getTime(),
      labelFn: bucketLabel,
      locale: 'es',
    })
    expect(rows.length).toBeGreaterThan(0)
    // First row should have a tempMean computed from the two models.
    expect(rows[0]?.tempMean).toBeTypeOf('number')
  })
})

describe('bucketLabel', () => {
  it('returns a HH:MM range for hour-aligned buckets', () => {
    const start = new Date(Date.UTC(2026, 6, 26, 14, 0, 0))
    const end = new Date(Date.UTC(2026, 6, 26, 17, 0, 0))
    expect(bucketLabel(start, end, 6, 'en', 7200, start.getTime())).toMatch(/14-17/)
    expect(bucketLabel(start, start, 1, 'en', 7200, start.getTime())).toMatch(/14:00/)
  })

  it('falls back to a numeric weekday label when the row is not today/tomorrow', () => {
    const start = new Date(Date.UTC(2026, 6, 30, 12, 0, 0)) // 2026-07-30
    const now = new Date(Date.UTC(2026, 6, 26, 12, 0, 0)) // 2026-07-26
    const label = bucketLabel(start, start, 24, 'en', 0, now.getTime())
    expect(label).not.toMatch(/today|tomorrow|ahora|mañana/i)
    // Should contain a weekday name + day-of-month (e.g. "Thu 30").
    expect(label).toMatch(/\b\d+\b/)
  })
})

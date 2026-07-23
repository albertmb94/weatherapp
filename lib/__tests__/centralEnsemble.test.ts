/**
 * Regression test for B-10-1:
 *   "en mobile, la temperatura que se muestra en 'AHORA' (prevision del
 *    tiempo) no coincide con la temperatura actual en Avanzado/insights a
 *    la hora actual".
 *
 * Root cause: `computeCurrentSnapshot` (used by the big "Tiempo actual"
 * card and the "AHORA" slot of the hourly strip) filters models by the
 * user's `selectedIds`, while `InsightsTable` in `wedai` mode uses the
 * full non-marine set. They compute different weighted averages for the
 * same hour, which is what the user saw as "two different temperatures
 * for the same hour".
 *
 * The fix centralises the ensemble logic in `lib/ensemble/central.ts` so
 * that both call sites produce the exact same number for the current
 * hour, regardless of which models the user has manually toggled in
 * Models mode. WedAI is enforced for "current hour" calculations (per
 * product decision: the current hour should always show the best
 * ensemble).
 *
 * This file is written BEFORE the fix and must fail on the current
 * code. After the fix it must pass.
 */
import { describe, it, expect } from 'vitest'
import {
  computeCurrentSnapshot,
  computeHourlySlots,
} from '@/lib/friendlyForecast'
import {
  MODELS,
  ENSEMBLE_PRESETS,
  METRIC_TO_ENSEMBLE,
  getLeadTimeBucket,
} from '@/lib/models'
import { weightedAvg } from '@/lib/ensemble'

/**
 * Replicates the EXACT current logic in `components/InsightsTable.tsx`
 * (rows aggregation, bucket=1, single hour). Kept here as a golden
 * reference so we can pin the divergence without spinning up React.
 *
 * After the fix this helper and `computeCurrentSnapshot` should
 * agree byte-for-byte when both are told the current hour is being
 * computed.
 */
function simulateInsightsTableRowMean(
  series: Record<string, Record<string, (number | null)[]>>,
  allModels: typeof MODELS,
  selectedIds: string[],
  hourIndex: number,
  currentHourMode: 'wedai' | 'models'
): number | null {
  const land = allModels.filter(m => m.id !== 'marine_global')
  const activeModels =
    currentHourMode === 'wedai'
      ? land
      : land.filter(m => selectedIds.includes(m.id))
  if (activeModels.length === 0) return null
  const presetId = METRIC_TO_ENSEMBLE['temperature'] ?? 'temperature'
  const preset =
    ENSEMBLE_PRESETS.find(p => p.id === presetId) ?? ENSEMBLE_PRESETS[0]
  const leadBucket = getLeadTimeBucket(hourIndex * 1) // bucket = 1
  const bucketWeights = preset.weights[leadBucket] ?? preset.weights['0-48h']
  const modelIds = activeModels.map(m => m.id)
  const vals = activeModels.map(
    m => series[m.id]?.['temperature']?.[hourIndex] ?? null
  )
  const weights = modelIds.map(id => bucketWeights[id] ?? 0.01)
  return weightedAvg(vals, weights)
}

function makeTimes(count: number): Date[] {
  const out: Date[] = []
  const base = new Date(Date.UTC(2026, 6, 23, 0, 0, 0)) // 23 Jul 2026
  for (let i = 0; i < count; i++) {
    out.push(new Date(base.getTime() + i * 3_600_000))
  }
  return out
}

describe('REGRESSION B-10-1: AHORA temp === InsightsTable active row temp', () => {
  // Fixture: 3 land models with different temperatures at hour 14.
  // The user has manually selected 2 of them in Models mode; the third
  // is deselected. In WedAI mode for the current hour all 3 count.
  const series = {
    ecmwf_ifs: {
      temperature: Array.from({ length: 48 }, (_, i) => (i === 14 ? 20 : 21)),
    },
    icon_global: { temperature: Array.from({ length: 48 }, () => 25) },
    gfs_global: { temperature: Array.from({ length: 48 }, () => 18) },
  }
  const times = makeTimes(48)
  const selectedIds = ['ecmwf_ifs', 'icon_global'] // user toggled gfs OFF

  it('AHORA (computeCurrentSnapshot) === InsightsTable row (WedAI forced for current hour)', () => {
    // After fix: friendlyForecast.computeCurrentSnapshot must respect
    // the "current hour = WedAI" rule and compute the same value the
    // InsightsTable active row shows for bucket=1 at hour=14.
    const snap = computeCurrentSnapshot(
      { time: times, series },
      MODELS,
      selectedIds, // ignored for "current hour" under the fix
      14
    )
    const rowMean = simulateInsightsTableRowMean(
      series,
      MODELS,
      selectedIds,
      14,
      'wedai'
    )

    expect(snap).not.toBeNull()
    expect(rowMean).not.toBeNull()
    expect(snap?.temperatureC).not.toBeNull()
    // Numerical equality: same hour, same model set, same weights.
    expect(snap?.temperatureC).toBeCloseTo(rowMean as number, 5)
  })

  it('AHORA hourLabel slot === computeCurrentSnapshot temperature', () => {
    // The "AHORA" slot in the hourly strip is computed by
    // computeHourlySlots with nowIndex=14. Its temperature should
    // equal the snapshot's temperatureC at the same hour (WedAI
    // forced).
    const slots = computeHourlySlots(
      { time: times, series },
      MODELS,
      selectedIds,
      14,
      'es',
      7,
      4,
      true // isViewingToday → "Ahora" label
    )
    const snap = computeCurrentSnapshot(
      { time: times, series },
      MODELS,
      selectedIds,
      14
    )

    const ahoraSlot = slots[0]
    expect(ahoraSlot).toBeDefined()
    expect(ahoraSlot.hourLabel.toLowerCase()).toBe('ahora')
    expect(ahoraSlot.tempC).not.toBeNull()
    expect(snap?.temperatureC).not.toBeNull()
    expect(ahoraSlot.tempC).toBeCloseTo(snap!.temperatureC as number, 5)
  })

  it('User toggling a model OFF does not change the AHORA temperature', () => {
    // Product rule (WedAI for current hour): the AHORA value is the
    // best ensemble regardless of which models the user has selected
    // for the chart/table. Toggling gfs_global OFF must not move the
    // AHORA number.
    const baseSnap = computeCurrentSnapshot(
      { time: times, series },
      MODELS,
      selectedIds, // gfs OFF
      14
    )
    const snapWithGfs = computeCurrentSnapshot(
      { time: times, series },
      MODELS,
      [...selectedIds, 'gfs_global'], // gfs ON
      14
    )

    expect(baseSnap?.temperatureC).not.toBeNull()
    expect(snapWithGfs?.temperatureC).not.toBeNull()
    expect(baseSnap?.temperatureC).toBeCloseTo(
      snapWithGfs!.temperatureC as number,
      5
    )
  })
})

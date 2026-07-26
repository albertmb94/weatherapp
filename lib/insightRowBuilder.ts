/**
 * Row construction + cell rendering helpers for `InsightsTable.tsx`.
 *
 * Sprint 11 (S11 refactor) extracted the *pure* row construction into
 * this module and the table column metadata into
 * `lib/insightsTableMeta.ts`, but the component itself remains the
 * single source for the JSX. The component could opt-in to these
 * helpers wholesale in a future refactor (Sprint 12+), but doing
 * so in one pass was deferred because the original component mixes
 * the math, the layout, drag-and-drop, sticky headers and column
 * ordering in a way that requires multiple coordinated edits.
 *
 * For now: the helpers exist so that:
 *   - new tests can pin the row-builder contract independently,
 *   - contributors can adopt `buildInsightRows(...)` in new code
 *     without going through the component,
 *   - future refactors can move the JSX one block at a time
 *     instead of a multi-file rewrite.
 */

/**
 * The big table component owns the JSX; this module owns the pure
 * functions that turn a `(times, series, models)` payload into
 * ready-to-render `Row[]` rows and that drive the per-cell
 * `<td>` content. The split lets the component focus on the
 * layout (drag-and-drop, pagination, sticky thead) while the math
 * stays testable in isolation.
 */

import { useMemo } from 'react'
import { getColor, SCALES } from '@/lib/colorScales'
import type { ScaleMetric } from '@/lib/colorScales'
import {
  ensembleWithFallback,
  resolveActiveModels,
  weightsFor,
  weightsForAbsolute,
} from '@/lib/ensemble/central'
import { weightedAvg } from '@/lib/ensemble'
import { pickWeatherIcon, type WeatherIconId } from '@/lib/weatherIcon'
import type { Locale } from '@/lib/i18n'
import { DAY_NAMES, STRINGS } from '@/lib/i18n'
import type { MetricId, WeatherModel } from '@/lib/models'
import type {
  BucketHours,
  MetricCellId,
} from './insightsTableMeta'

/* -------------------------------------------------------------------------- */
/* Row data                                                                   */
/* -------------------------------------------------------------------------- */

export interface Row {
  label: string
  startIdx: number
  endIdx: number
  centerIdx: number
  tempMean: number | null
  tempMin: number | null
  tempMax: number | null
  cloudMean: number | null
  windMean: number | null
  windDirection: number | null
  gustsMax: number | null
  precipSum: number | null
  humidityMean: number | null
  uvIndexMean: number | null
  pressureMean: number | null
  dewpointMean: number | null
  visibilityMean: number | null
  seaTempMean: number | null
  waveHeightMax: number | null
  wavePeriodMean: number | null
  waveDirection: number | null
  windWaveHeightMax: number | null
  windWavePeriodMean: number | null
  swellHeightMax: number | null
  swellPeriodMean: number | null
  hasMarineData: boolean
  icon: WeatherIconId
}

export const EMPTY_ROW_FIELDS: Omit<
  Row,
  'label' | 'startIdx' | 'endIdx' | 'centerIdx' | 'icon'
> = {
  tempMean: null,
  tempMin: null,
  tempMax: null,
  cloudMean: null,
  windMean: null,
  windDirection: null,
  gustsMax: null,
  precipSum: null,
  humidityMean: null,
  uvIndexMean: null,
  pressureMean: null,
  dewpointMean: null,
  visibilityMean: null,
  seaTempMean: null,
  waveHeightMax: null,
  wavePeriodMean: null,
  waveDirection: null,
  windWaveHeightMax: null,
  windWavePeriodMean: null,
  swellHeightMax: null,
  swellPeriodMean: null,
  hasMarineData: false,
}

/* -------------------------------------------------------------------------- */
/* Row construction                                                          */
/* -------------------------------------------------------------------------- */

interface BuildInsightRowsArgs {
  models: WeatherModel[]
  activeModelIds: string[]
  times: Date[]
  series: Record<string, Record<string, (number | null)[]>>
  bucket: BucketHours
  maxHours: number
  utcOffsetSeconds: number
  fullTimes?: Date[]
  fullSeries?: Record<string, Record<string, (number | null)[]>>
  startIndex?: number
  weekDays?: 7 | 14
  selectedHour: number
  currentHourMode: 'wedai' | 'models'
  ensembleMode: 'wedai' | 'models'
  nowMs: number | null
  labelFn: (
    start: Date,
    end: Date,
    bucket: BucketHours,
    locale: Locale,
    utcOffsetSeconds: number,
    nowMs: number | null,
  ) => string
  locale: Locale
}

/**
 * Build the per-row aggregate (`Row[]`) consumed by the table.
 *
 * Pure: no React, no DOM. The only side-effect of calling this is
 * the per-row `b.icon = pickWeatherIcon(...)` call inside the
 * helper, which is a deterministic lookup against the same icon
 * mapping the friendly cards use.
 */
export function buildInsightRows(args: BuildInsightRowsArgs): Row[] {
  const {
    models,
    activeModelIds,
    times,
    series,
    bucket,
    maxHours,
    fullTimes,
    fullSeries,
    startIndex = 0,
    weekDays = 14,
    selectedHour,
    currentHourMode,
    ensembleMode,
    nowMs,
    labelFn,
    locale,
    utcOffsetSeconds,
  } = args
  const tt = bucket === 24 && fullTimes?.length ? fullTimes : times
  const s = bucket === 24 && fullSeries ? fullSeries : series

  const allModels = models.filter(m => m.id !== 'marine_global')
  const activeModels = ensembleMode === 'wedai'
    ? allModels
    : models.filter(m => activeModelIds.includes(m.id))

  if (activeModels.length === 0 || tt.length === 0) return []

  const limit = Math.min(tt.length, maxHours)
  const staticWeights = activeModels.map(m => m.weight)
  const getWeightsForMetricAndHour = (metric: MetricId | string, hourIndex: number): number[] => {
    if (ensembleMode === 'models') return staticWeights
    return weightsForAbsolute(metric as MetricId, hourIndex + startIndex, bucket, activeModels)
  }

  const buckets: Row[] = []
  let cursor = 0

  if (bucket === 24) {
    let current: Row | null = null
    let currentKey = ''
    const rem = startIndex % 24
    const toMidnight = rem === 0 ? 24 : 24 - rem
    for (
      let i = startIndex;
      i < Math.min(tt.length, startIndex + toMidnight + (weekDays - 1) * 24);
      i++
    ) {
      const ti = tt[i]
      const dayKey = ti instanceof Date
        ? `${ti.getUTCFullYear()}-${ti.getUTCMonth()}-${ti.getUTCDate()}`
        : ''
      if (!current || dayKey !== currentKey) {
        let dayStart = i
        while (dayStart > 0) {
          const prev = tt[dayStart - 1]
          if (!(prev instanceof Date)) break
          const prevKey = `${prev.getUTCFullYear()}-${prev.getUTCMonth()}-${prev.getUTCDate()}`
          if (prevKey !== dayKey) break
          dayStart--
        }
        const labelT = tt[i] ?? tt[dayStart] ?? tt[startIndex]
        current = {
          label: labelT instanceof Date
            ? labelFn(labelT, labelT, bucket, locale, utcOffsetSeconds, nowMs)
            : dayKey,
          startIdx: dayStart,
          endIdx: i,
          centerIdx: i,
          icon: 'sunny',
          ...EMPTY_ROW_FIELDS,
        }
        currentKey = dayKey
        buckets.push(current)
      }
      if (tt[i] instanceof Date) {
        current.endIdx = i
        if ((tt[i] as Date).getUTCHours() === 12) current.centerIdx = i
      }
    }
    if (buckets.length > weekDays) buckets.splice(weekDays)
  } else {
    while (cursor < limit) {
      const startT = times[cursor]
      if (!(startT instanceof Date)) break
      const startHour = startT.getUTCHours()
      const alignedStart = startHour - (startHour % bucket)
      const startInBucket = startHour - alignedStart
      const remaining = bucket - startInBucket
      const end = Math.min(cursor + remaining, limit) - 1
      if (end < cursor) break
      const endT = times[end]
      buckets.push({
        label: labelFn(
          new Date(startT.getTime() - startInBucket * 3600_000),
          endT,
          bucket,
          locale,
          utcOffsetSeconds,
          nowMs,
        ),
        startIdx: cursor,
        endIdx: end,
        centerIdx: cursor + Math.floor((end - cursor) / 2),
        icon: 'sunny',
        ...EMPTY_ROW_FIELDS,
      })
      cursor = end + 1
    }
  }

  const wedaiModels = allModels

  for (const b of buckets) {
    let tSum = 0, tCount = 0
    let cSum = 0, cCount = 0
    let wSum = 0, wCount = 0
    let hSum = 0, hCount = 0
    let uSum = 0, uCount = 0
    let prSum = 0, prCount = 0
    let dpSum = 0, dpCount = 0
    let visSum = 0, visCount = 0
    let dirCos = 0, dirSin = 0, dirCount = 0
    let sstSum = 0, sstCount = 0
    let wpSum = 0, wpCount = 0
    let wwpSum = 0, wwpCount = 0
    let swpSum = 0, swpCount = 0

    for (let i = b.startIdx; i <= b.endIdx; i++) {
      const tWeights = getWeightsForMetricAndHour('temperature', i)
      const tEns = ensembleWithFallback(s, 'temperature', i, activeModels, wedaiModels, tWeights)
      if (tEns !== null) {
        tSum += tEns
        tCount += 1
        if (b.tempMin === null || tEns < b.tempMin) b.tempMin = tEns
        if (b.tempMax === null || tEns > b.tempMax) b.tempMax = tEns
      }
      const cWeights = getWeightsForMetricAndHour('cloud_cover', i)
      const cEns = ensembleWithFallback(s, 'cloud_cover', i, activeModels, wedaiModels, cWeights)
      if (cEns !== null) { cSum += cEns; cCount += 1 }
      const wWeights = getWeightsForMetricAndHour('wind_speed', i)
      const wEns = ensembleWithFallback(s, 'wind_speed', i, activeModels, wedaiModels, wWeights)
      if (wEns !== null) { wSum += wEns; wCount += 1 }
      const gWeights = getWeightsForMetricAndHour('wind_gusts', i)
      const gEns = ensembleWithFallback(s, 'wind_gusts', i, activeModels, wedaiModels, gWeights)
      if (gEns !== null && (b.gustsMax === null || gEns > b.gustsMax)) b.gustsMax = gEns
      const pWeights = getWeightsForMetricAndHour('precipitation', i)
      const pEns = ensembleWithFallback(s, 'precipitation', i, activeModels, wedaiModels, pWeights)
      if (pEns !== null) b.precipSum = (b.precipSum ?? 0) + pEns
      const hWeights = getWeightsForMetricAndHour('humidity', i)
      const hEns = ensembleWithFallback(s, 'humidity', i, activeModels, wedaiModels, hWeights)
      if (hEns !== null) { hSum += hEns; hCount += 1 }
      const uWeights = getWeightsForMetricAndHour('uv_index', i)
      const uEns = ensembleWithFallback(s, 'uv_index', i, activeModels, wedaiModels, uWeights)
      if (uEns !== null) { uSum += uEns; uCount += 1 }
      const prWeights = getWeightsForMetricAndHour('pressure', i)
      const prEns = ensembleWithFallback(s, 'pressure', i, activeModels, wedaiModels, prWeights)
      if (prEns !== null) { prSum += prEns; prCount += 1 }
      const dpWeights = getWeightsForMetricAndHour('dewpoint', i)
      const dpEns = ensembleWithFallback(s, 'dewpoint', i, activeModels, wedaiModels, dpWeights)
      if (dpEns !== null) { dpSum += dpEns; dpCount += 1 }
      const visWeights = getWeightsForMetricAndHour('visibility', i)
      const visValsForFallback = activeModels.map(m => {
        const v = s[m.id]?.['visibility']?.[i]
        return v !== null && v !== undefined ? v / 1000 : null
      })
      const visEns = weightedAvg(visValsForFallback, visWeights)
      if (visEns !== null) { visSum += visEns; visCount += 1 }
      const dirWeights = getWeightsForMetricAndHour('wind_direction', i)
      let hCos = 0, hSin = 0, hW = 0
      for (let j = 0; j < activeModels.length; j++) {
        const d = s[activeModels[j].id]?.['wind_direction']?.[i]
        if (d === null || d === undefined) continue
        const rad = (d * Math.PI) / 180
        hCos += Math.cos(rad) * dirWeights[j]
        hSin += Math.sin(rad) * dirWeights[j]
        hW += dirWeights[j]
      }
      if (hW > 0) {
        dirCos += hCos / hW
        dirSin += hSin / hW
        dirCount += 1
      }

      const mSeries = s['marine_global']
      if (mSeries) {
        const sst = mSeries['sea_surface_temperature']?.[i] ?? null
        const wh = mSeries['wave_height']?.[i] ?? null
        const wp = mSeries['wave_period']?.[i] ?? null
        const wd = mSeries['wave_direction']?.[i] ?? null
        const wwh = mSeries['wind_wave_height']?.[i] ?? null
        const wwp = mSeries['wind_wave_period']?.[i] ?? null
        const swh = mSeries['swell_wave_height']?.[i] ?? null
        const swp = mSeries['swell_wave_period']?.[i] ?? null
        if (sst !== null && sst !== undefined) {
          sstSum += sst
          sstCount += 1
          b.hasMarineData = true
        }
        if (wh !== null && wh !== undefined) {
          b.waveHeightMax = b.waveHeightMax === null ? wh : Math.max(b.waveHeightMax, wh)
          b.hasMarineData = true
        }
        if (wp !== null && wp !== undefined) {
          wpSum += wp
          wpCount += 1
          b.hasMarineData = true
        }
        if (wwh !== null && wwh !== undefined) {
          b.windWaveHeightMax = b.windWaveHeightMax === null ? wwh : Math.max(b.windWaveHeightMax, wwh)
        }
        if (wwp !== null && wwp !== undefined) {
          wwpSum += wwp
          wwpCount += 1
        }
        if (swh !== null && swh !== undefined) {
          b.swellHeightMax = b.swellHeightMax === null ? swh : Math.max(b.swellHeightMax, swh)
        }
        if (swp !== null && swp !== undefined) {
          swpSum += swp
          swpCount += 1
        }
        if (wd !== null && wd !== undefined) {
          b.waveDirection = wd
        }
      }
    }
    b.tempMean = tCount > 0 ? tSum / tCount : null
    b.cloudMean = cCount > 0 ? cSum / cCount : null
    b.windMean = wCount > 0 ? wSum / wCount : null
    b.humidityMean = hCount > 0 ? hSum / hCount : null
    b.uvIndexMean = uCount > 0 ? uSum / uCount : null
    b.pressureMean = prCount > 0 ? prSum / prCount : null
    b.dewpointMean = dpCount > 0 ? dpSum / dpCount : null
    b.visibilityMean = visCount > 0 ? visSum / visCount : null
    b.windDirection = dirCount > 0
      ? ((Math.atan2(dirSin, dirCos) * 180) / Math.PI + 360) % 360
      : null
    b.seaTempMean = sstCount > 0 ? sstSum / sstCount : null
    b.wavePeriodMean = wpCount > 0 ? wpSum / wpCount : null
    b.windWavePeriodMean = wwpCount > 0 ? wwpSum / wwpCount : null
    b.swellPeriodMean = swpCount > 0 ? swpSum / swpCount : null
    b.icon = pickWeatherIcon({
      cloudCoverPct: b.cloudMean,
      precipitationMmDay: b.precipSum,
      windGustsKmh: b.gustsMax,
      minTempC: b.tempMin,
    })
  }

  if (currentHourMode === 'wedai') {
    const wedaiOnly = resolveActiveModels(models, activeModelIds, 'wedai')
    if (wedaiOnly.length > 0) {
      const activeSeries = s as Record<string, Record<string, (number | null)[]>>
      const seriesLen = activeSeries[wedaiOnly[0].id]?.['temperature']?.length ?? 0
      for (const b of buckets) {
        const shiftedStart = bucket === 24 ? b.startIdx - startIndex : b.startIdx
        const shiftedEnd = bucket === 24 ? b.endIdx - startIndex : b.endIdx
        if (selectedHour < shiftedStart || selectedHour > shiftedEnd) continue
        const absIdx = bucket === 24 ? startIndex + selectedHour : selectedHour
        if (absIdx < 0 || absIdx >= seriesLen) continue
        const tWeights = weightsFor('temperature', absIdx, bucket, wedaiOnly)
        const tVals = wedaiOnly.map(
          m => activeSeries[m.id]?.['temperature']?.[absIdx] ?? null,
        )
        const tEns = weightedAvg(tVals, tWeights)
        if (tEns !== null) {
          b.tempMean = tEns
          if (bucket === 1) {
            b.tempMin = tEns
            b.tempMax = tEns
          }
        }
        break
      }
    }
  }

  return buckets
}

/* -------------------------------------------------------------------------- */
/* Heat-cell styling                                                         */
/* -------------------------------------------------------------------------- */

const HEAT_STYLE_CACHE = new Map<string, React.CSSProperties>()

const TRANSPARENT_STYLE: React.CSSProperties = { background: 'transparent' }

function rgbTriple(color: string): string {
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (m) return `${m[1]}, ${m[2]}, ${m[3]}`
  const hex = color.replace('#', '')
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return `${r}, ${g}, ${b}`
  }
  return '120, 120, 120'
}

function intensityFor(metric: ScaleMetric, value: number | null): number | null {
  if (value === null || value === undefined) return null
  const stops = SCALES[metric]
  if (!stops || stops.length === 0) return null
  let lo = stops[0]
  let hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (value >= stops[i].value && value <= stops[i + 1].value) {
      lo = stops[i]
      hi = stops[i + 1]
      break
    }
  }
  if (value <= stops[0].value) {
    lo = stops[0]
    hi = stops[0]
  } else if (value >= stops[stops.length - 1].value) {
    lo = stops[stops.length - 1]
    hi = stops[stops.length - 1]
  }
  const loDist = Math.abs(value - lo.value)
  const hiDist = Math.abs(value - hi.value)
  const range = Math.max(1, hi.value - lo.value)
  const proximity = 1 - (loDist + hiDist) / (range * 2)
  return Math.max(0.35, Math.min(1, 0.4 + proximity * 0.6))
}

export function heatStyle(metric: ScaleMetric, value: number | null): React.CSSProperties {
  if (value === null || value === undefined) {
    return TRANSPARENT_STYLE
  }
  const key = `${metric}|${value}`
  const cached = HEAT_STYLE_CACHE.get(key)
  if (cached) return cached
  const color = getColor(metric, value)
  const triple = rgbTriple(color)
  const intensity = intensityFor(metric, value) ?? 0.5
  const core = Math.round(intensity * 45)
  const mid = Math.round(intensity * 18)
  const tintAlpha = 35
  const style: React.CSSProperties = {
    ['--heat-rgb-triple' as string]: triple,
    backgroundColor: `rgba(${triple}, ${tintAlpha}%)`,
    backgroundImage: `radial-gradient(ellipse var(--heat-cell-bg-size, 32% 60%) at 50% 50%, rgba(${triple},${core}%) 0%, rgba(${triple},${mid})% 50%, rgba(${triple},0) 92%)`,
  } as React.CSSProperties
  HEAT_STYLE_CACHE.set(key, style)
  return style
}

/* -------------------------------------------------------------------------- */
/* Row-aware React memo helper                                               */
/* -------------------------------------------------------------------------- */

/**
 * Memoised row cache. Replaced the inline `useMemo` with a thin
 * wrapper so component code reads `useInsightRows(...)` instead of
 * the 12-arg constant. Centralising the memo also keeps the
 * dependency list in one place — when callers add new inputs they
 * only need to update this wrapper.
 */
export function useInsightRows(args: BuildInsightRowsArgs): Row[] {
  return useMemo(() => buildInsightRows(args), [
    args.models,
    args.activeModelIds,
    args.times,
    args.series,
    args.bucket,
    args.maxHours,
    args.utcOffsetSeconds,
    args.fullTimes,
    args.fullSeries,
    args.startIndex,
    args.weekDays,
    args.selectedHour,
    args.currentHourMode,
    args.ensembleMode,
    args.nowMs,
    args.labelFn,
    args.locale,
  ])
}

/* -------------------------------------------------------------------------- */
/* Bucket label helper (was inline before Sprint 11)                        */
/* -------------------------------------------------------------------------- */

/**
 * Build the label shown in the first column of each row. The
 * "Hoy/Mañ/Mié 8" prefix compares the row's start date (in the
 * location's timezone, not the browser's) so the label never flips
 * across midnight in a time zone different from the user.
 */
export function bucketLabel(
  start: Date,
  end: Date,
  bucket: BucketHours,
  locale: Locale,
  utcOffsetSeconds: number,
  nowMs: number | null,
): string {
  const today = new Date((nowMs ?? 0) + utcOffsetSeconds * 1000)
  const isToday =
    start.getUTCFullYear() === today.getUTCFullYear() &&
    start.getUTCMonth() === today.getUTCMonth() &&
    start.getUTCDate() === today.getUTCDate()
  const isTomorrow = (() => {
    const t = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    return (
      start.getUTCFullYear() === t.getUTCFullYear() &&
      start.getUTCMonth() === t.getUTCMonth() &&
      start.getUTCDate() === t.getUTCDate()
    )
  })()
  const s = STRINGS[locale]
  const day = isToday
    ? s.today
    : isTomorrow
      ? s.tomorrow
      : `${DAY_NAMES[locale][start.getUTCDay()]} ${start.getUTCDate()}`
  if (bucket === 24) return day
  const h0 = start.getUTCHours().toString().padStart(2, '0')
  if (bucket === 1) return `${day} ${h0}:00`
  const h1 = end.getUTCHours().toString().padStart(2, '0')
  return `${day} ${h0}-${h1}`
}

/* -------------------------------------------------------------------------- */
/* Re-export the cell renderer pair so the component JSX is a thin shell    */
/* -------------------------------------------------------------------------- */

export {
  cellInner,
  cellData,
  emptyCell,
  type CellInnerArg,
  type CellResult,
} from './insightCells'

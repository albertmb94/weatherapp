'use client'

import { useMemo } from 'react'
import type { MetricId, WeatherModel } from '@/lib/models'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import { getLocationNow } from '@/lib/dateUtils'
import {
  computeCurrentSnapshot,
  type CurrentSnapshot,
} from '@/lib/friendlyForecast'
import { useNowcast } from '@/lib/hooks/useNowcast'
import { useClientNow } from '@/lib/hooks/useClientNow'
import ProfileChip from './ProfileChip'
import type { UsageProfile } from '@/lib/profiles'
import type { StationObservation } from '@/lib/nowcast'
import CurrentWeatherCard from './CurrentWeatherCard'
import HourlyForecastStrip from './HourlyForecastStrip'
import AirConditionsGrid from './AirConditionsGrid'

/**
 * Build a per-hour "mean across contributing models" series for a
 * given metric. Used by the nowcast hook so we can compare the
 * ensemble average with the closest station reading without having
 * to recompute the weights on every render. `null` for hours with no
 * contributing model.
 */
function buildMeanSeries(
  time: Date[],
  series: Record<string, Record<string, (number | null)[]>>,
  metric: MetricId,
): (number | null)[] {
  // The horizon is bounded by the longest array we find across models.
  // We don't try to align different lengths; instead we walk i while
  // every model still has a slot and stop otherwise.
  let maxLen = 0
  for (const modelId of Object.keys(series)) {
    const arr = series[modelId]?.[metric]
    if (Array.isArray(arr) && arr.length > maxLen) maxLen = arr.length
  }
  maxLen = Math.min(maxLen, time.length || Infinity)
  const out: (number | null)[] = []
  for (let i = 0; i < maxLen; i++) {
    const samples: number[] = []
    for (const modelId of Object.keys(series)) {
      const v = series[modelId]?.[metric]?.[i]
      if (typeof v === 'number') samples.push(v)
    }
    out.push(samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : null)
  }
  return out
}

interface FriendlyHomeProps {
  city: string
  cityIsLoading: boolean
  models: WeatherModel[]
  activeIds: string[]
  /**
   * Full untrimmed forecast (must cover today 00:00). Used by the hourly
   * strip so today can be sliced into 4-hour blocks starting at 00:00.
   */
  time: Date[]
  series: Record<string, Record<string, (number | null)[]>>
  /** Index in `time` (full) of the current local hour. */
  nowIndex: number
  /** Hour offset the user selected relative to the current hour. When 0
   * we are showing the live-now state; otherwise the labels should make
   * it clear this is a forecast for a future hour. */
  selectedHourOffset: number
  /** UTC offset seconds for the location (used to derive "today" for the
   * "Ahora" label in the hourly strip). */
  utcOffsetSeconds?: number
  /** Live UV reading from the provider's `current=uv_index` block. Only
   * applied while selectedHourOffset === 0. */
  liveUvIndex?: number | null
  /** Validity timestamp for the live UV reading (provider-reported). */
  liveUvValidAt?: Date | null
  /** Localised freshness for the UI. */
  fetchedAt?: number | null
  /** Forecast age (ms) — used to flag the card when the data is stale. */
  forecastAgeMs?: number | null
  /** B-NEW-10 (2026-07-25): ensemble mode for the hourly strip's
   *  future slots. The big "Tiempo actual" card (computeCurrentSnapshot)
   *  is ALWAYS WedAI regardless of this value (the current hour is a
   *  "best estimate" overview per B-10-1). Default is `'wedai'` so the
   *  user-friendly card surfaces the calibrated ensemble when no
   *  caller opts in (e.g. older deep links). */
  ensembleMode?: 'wedai' | 'models'
  /** Daily accumulated precipitation aligned with `time` by index 0.
   *  Surfaced in the AirConditionsGrid "Total hoy" tile. */
  dailyPrecipitationSum?: (number | null)[]
  /** Stations within the user's radius. The friendly cards blend the
   *  ensemble reading at the current hour with the closest fresh
   *  station so the "now" reading carries real-world anchoring. */
  stations?: StationObservation[]
  /** User's current coordinate (lat/lon). Threaded down to `useNowcast`
   *  so the closest-station lookup actually centres on the user's
   *  position. The previous build hard-coded (0, 0) which produced
   *  Atlantic-Ocean stations as the "closest match" — a real bug. */
  userLat?: number
  userLon?: number
  /** Sprint 13: the auto-derived profile for the current location.
   *  Surfaced as a small chip next to the "Tiempo actual" card so the
   *  user can see at a glance which profile is biasing the ensemble
   *  (e.g. "Costero"). `null` while the classifier is in flight, in
   *  which case the chip is hidden. */
  usageProfile?: UsageProfile | null
  /** Sprint 13: number of backtest-recommended models that were
   *  actually applied as a weight boost (intersection of the
   *  recommendation with the user's active set). 0 means no boost
   *  was applied — chip shows the neutral label. */
  usageProfileBoostedCount?: number
  /** Sprint 13: full backtest recommendation set, threaded down to
   *  `computeCurrentSnapshot` so the snapshot's `meanAcrossModels`
   *  uses `weightsForProfile` and biases the recommended models.
   *  An empty Set means no boost — the snapshot degrades to the
   *  pre-Sprint-13 behaviour byte-for-byte. */
  usageProfileRecommended?: ReadonlySet<string>
}

export default function FriendlyHome({
  city,
  cityIsLoading,
  models,
  activeIds,
  time,
  series,
  nowIndex,
  selectedHourOffset,
  utcOffsetSeconds = 0,
  liveUvIndex = null,
  liveUvValidAt = null,
  fetchedAt = null,
  forecastAgeMs = null,
  ensembleMode = 'wedai',
  dailyPrecipitationSum,
  stations = [],
  userLat = 0,
  userLon = 0,
  usageProfile = null,
  usageProfileBoostedCount = 0,
  usageProfileRecommended = new Set(),
}: FriendlyHomeProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]
  // BUG FIX: previous build never threaded a wall-clock down to
  // `CurrentWeatherCard`, so the weekday label was always empty in
  // production. Tick once a minute (matches the rest of the app) so
  // the day boundary updates at midnight.
  const currentTickMs = useClientNow(60_000) ?? 0

  const isLiveNow = selectedHourOffset === 0
  const snapshot: CurrentSnapshot | null = useMemo(
    () => computeCurrentSnapshot(
      { time, series },
      models,
      activeIds,
      nowIndex,
      // Only apply the live UV override while the user is on the current
      // hour. Selecting a future hour keeps the ensemble value so the
      // UV "follows" the rest of the snapshot for that future point.
      isLiveNow ? liveUvIndex : null,
      // Sprint 13: thread the auto-derived profile + backtest
      // recommendation down to computeCurrentSnapshot so every
      // `meanAcrossModels` call inside uses `weightsForProfile`
      // instead of `weightsFor`. Default-arg semantics in
      // friendlyForecast.ts make this safe to leave undefined here
      // — when usageProfile is null (classifier still in flight) we
      // skip the boost and use the pre-Sprint-13 weights exactly.
      usageProfile,
      usageProfileRecommended,
    ),
    [models, activeIds, time, series, nowIndex, liveUvIndex, isLiveNow, usageProfile, usageProfileRecommended]
  )

  const isViewingToday = useMemo(() => {
    const nowT = time[nowIndex]
    if (!(nowT instanceof Date)) return true
    const today = getLocationNow(utcOffsetSeconds)
    return (
      nowT.getUTCFullYear() === today.getUTCFullYear() &&
      nowT.getUTCMonth() === today.getUTCMonth() &&
      nowT.getUTCDate() === today.getUTCDate()
    )
  }, [time, nowIndex, utcOffsetSeconds])

  // S10: blend the closest fresh station with the first hour of the
  // ensemble. Only effective while the user is on "now" (`isLiveNow`).
  // On future hours we hide the result so the user sees the pure ensemble.
  const hourlyTemperatureC = useMemo(
    () => buildMeanSeries(time, series, 'temperature'),
    [time, series],
  )
  const hourlyPrecipitationMm = useMemo(
    () => buildMeanSeries(time, series, 'precipitation'),
    [time, series],
  )
  const nowcastResult = useNowcast({
    userLat,
    userLon,
    nowIndex,
    hourlyTemperatureC,
    hourlyPrecipitationMm,
    stations,
  })

  return (
    <div className="space-y-3 md:space-y-4">
      {usageProfile !== null && usageProfile !== undefined ? (
        <div className="flex items-center gap-2 flex-wrap" data-testid="profile-chip-row">
          <ProfileChip
            profile={usageProfile}
            boostedCount={usageProfileBoostedCount}
          />
        </div>
      ) : null}
      <CurrentWeatherCard
        city={city}
        snapshot={snapshot}
        loading={cityIsLoading && snapshot === null}
        fetchedAt={fetchedAt}
        forecastAgeMs={forecastAgeMs}
        liveUv={liveUvIndex ?? null}
        liveUvValidAt={liveUvValidAt ?? null}
        nowcastTemperatureC={isLiveNow ? nowcastResult.temperatureC : null}
        nowcastDeltaC={isLiveNow ? nowcastResult.observationDeltaC : null}
        nowcastStationName={
          isLiveNow && nowcastResult.station
            ? `${nowcastResult.station.id} · ${nowcastResult.station.distanceKm.toFixed(1)} km`
            : null
        }
        // BUG FIX: wallClockMs was declared in the prop type but
        // never threaded down from the parent, so the weekday label
        // was always empty in production. Use the same wall-clock
        // tick the rest of the home view reads.
        wallClockMs={currentTickMs}
      />
      <HourlyForecastStrip
        models={models}
        activeIds={activeIds}
        time={time}
        series={series}
        nowIndex={nowIndex}
        isViewingToday={isViewingToday}
        title={s.hourlyTitle}
        ensembleMode={ensembleMode}
      />
      <AirConditionsGrid
        snapshot={snapshot}
        isLiveNow={isLiveNow}
        liveUv={liveUvIndex ?? null}
        liveUvValidAt={liveUvValidAt ?? null}
        fetchedAt={fetchedAt ?? null}
        forecastAgeMs={forecastAgeMs ?? null}
        dailyPrecipitationSum={dailyPrecipitationSum}
      />
    </div>
  )
}

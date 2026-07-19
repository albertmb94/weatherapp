'use client'

import { useMemo } from 'react'
import type { WeatherModel } from '@/lib/models'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import { getLocationNow } from '@/lib/dateUtils'
import {
  computeCurrentSnapshot,
  type CurrentSnapshot,
} from '@/lib/friendlyForecast'
import CurrentWeatherCard from './CurrentWeatherCard'
import HourlyForecastStrip from './HourlyForecastStrip'
import AirConditionsGrid from './AirConditionsGrid'

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
   *  we are showing the live-now state; otherwise the labels should make
   *  it clear this is a forecast for a future hour. */
  selectedHourOffset: number
  /** UTC offset seconds for the location (used to derive "today" for the
   *  "Ahora" label in the hourly strip). */
  utcOffsetSeconds?: number
  /** Live UV reading from the provider's `current=uv_index` block. Only
   *  applied while selectedHourOffset === 0. */
  liveUvIndex?: number | null
  /** Validity timestamp for the live UV reading (provider-reported). */
  liveUvValidAt?: Date | null
  /** Localised freshness for the UI. */
  fetchedAt?: number | null
  /** Forecast age (ms) — used to flag the card when the data is stale. */
  forecastAgeMs?: number | null
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
}: FriendlyHomeProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]

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
    ),
    [models, activeIds, time, series, nowIndex, liveUvIndex, isLiveNow]
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

  return (
    <div className="space-y-3 md:space-y-4">
      <CurrentWeatherCard
        city={city}
        snapshot={snapshot}
        loading={cityIsLoading && snapshot === null}
        fetchedAt={fetchedAt}
        forecastAgeMs={forecastAgeMs}
        liveUv={liveUvIndex ?? null}
        liveUvValidAt={liveUvValidAt ?? null}
      />
      <HourlyForecastStrip
        models={models}
        activeIds={activeIds}
        time={time}
        series={series}
        nowIndex={nowIndex}
        isViewingToday={isViewingToday}
        title={s.hourlyTitle}
      />
      <AirConditionsGrid
        snapshot={snapshot}
        isLiveNow={isLiveNow}
        liveUv={liveUvIndex ?? null}
        liveUvValidAt={liveUvValidAt ?? null}
        fetchedAt={fetchedAt ?? null}
        forecastAgeMs={forecastAgeMs ?? null}
      />
    </div>
  )
}

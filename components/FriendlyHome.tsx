'use client'

import { useMemo } from 'react'
import type { WeatherModel } from '@/lib/models'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
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
}

export default function FriendlyHome({
  city,
  cityIsLoading,
  models,
  activeIds,
  time,
  series,
  nowIndex,
}: FriendlyHomeProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]

  const snapshot: CurrentSnapshot | null = useMemo(
    () => computeCurrentSnapshot({ time, series }, models, activeIds, nowIndex),
    [models, activeIds, time, series, nowIndex]
  )

  return (
    <div className="space-y-3 md:space-y-4">
      <CurrentWeatherCard city={city} snapshot={snapshot} loading={cityIsLoading && snapshot === null} />
      <HourlyForecastStrip
        models={models}
        activeIds={activeIds}
        time={time}
        series={series}
        nowIndex={nowIndex}
        title={s.hourlyTitle}
      />
      <AirConditionsGrid snapshot={snapshot} />
    </div>
  )
}

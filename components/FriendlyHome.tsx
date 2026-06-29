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
  time: Date[]
  series: Record<string, Record<string, (number | null)[]>>
  /** Index in the (already trimmed) series that corresponds to the user's
   *  currently-selected hour. Defaults to 0. */
  selectedIndex: number
}

export default function FriendlyHome({
  city,
  cityIsLoading,
  models,
  activeIds,
  time,
  series,
  selectedIndex,
}: FriendlyHomeProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]

  const snapshot: CurrentSnapshot | null = useMemo(
    () => computeCurrentSnapshot({ time, series }, models, activeIds, selectedIndex),
    [models, activeIds, time, series, selectedIndex]
  )

  return (
    <div className="space-y-3 md:space-y-4">
      <CurrentWeatherCard city={city} snapshot={snapshot} loading={cityIsLoading && snapshot === null} />
      <HourlyForecastStrip
        models={models}
        activeIds={activeIds}
        time={time}
        series={series}
        startIndex={selectedIndex}
        title={s.hourlyTitle}
      />
      <AirConditionsGrid snapshot={snapshot} />
    </div>
  )
}

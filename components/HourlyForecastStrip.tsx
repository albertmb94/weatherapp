'use client'

import { useMemo } from 'react'
import type { WeatherModel } from '@/lib/models'
import { useLocale } from '@/lib/LocaleContext'
import type { HourlySlot } from '@/lib/friendlyForecast'
import { computeHourlySlots } from '@/lib/friendlyForecast'
import WeatherConditionIcon from './WeatherConditionIcon'

interface HourlyForecastStripProps {
  models: WeatherModel[]
  activeIds: string[]
  /** Full untrimmed forecast (must include today's 00:00). */
  time: Date[]
  series: Record<string, Record<string, (number | null)[]>>
  /** Index in `time` of the current local hour. */
  nowIndex: number
  /** When false, the "Ahora" / "Now" label is suppressed (the caller
   *  has selected a future day). Defaults to true. */
  isViewingToday?: boolean
  title: string
}

function fmtTemp(value: number | null): string {
  return value === null ? '–' : `${Math.round(value)}°`
}

export default function HourlyForecastStrip({
  models,
  activeIds,
  time,
  series,
  nowIndex,
  isViewingToday = true,
  title,
}: HourlyForecastStripProps) {
  const { locale } = useLocale()

  const slots = useMemo<HourlySlot[]>(
    () => computeHourlySlots({ time, series }, models, activeIds, nowIndex, locale, 7, 4, isViewingToday),
    [models, activeIds, time, series, nowIndex, locale, isViewingToday]
  )

  if (slots.length === 0) return null

  return (
    <section
      aria-label={title}
      className="rounded-2xl border border-border bg-surface-raised p-4 md:p-5"
    >
      <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold mb-3">
        {title}
      </h3>
      <ol className="flex gap-1.5 md:gap-2 overflow-x-auto scrollbar-none pb-1">
        {slots.map((slot, i) => {
          const isNowSlot = i === 0 && slot.hourLabel.toLowerCase() === 'ahora'
          return (
            <li
              key={`${slot.index}-${i}`}
              className={`relative flex flex-col items-center gap-1 md:gap-1.5 min-w-[58px] md:min-w-0 md:flex-1 px-1 py-1.5 rounded-lg ${
                isNowSlot ? 'bg-accent-soft/40 ring-1 ring-accent/40' : ''
              }`}
            >
              <span
                className={`text-[10px] uppercase tracking-wide tabular-nums ${
                  isNowSlot
                    ? 'text-accent font-semibold'
                    : slot.isPast
                      ? 'text-text-muted'
                      : 'text-text-secondary'
                }`}
              >
                {slot.hourLabel}
              </span>
              <WeatherConditionIcon icon={slot.icon} />
              <span className="text-sm md:text-base font-semibold text-text-primary tabular-nums">
                {fmtTemp(slot.tempC)}
              </span>
              {slot.precipMm !== null && slot.precipMm > 0 ? (
                <span className="text-[9px] text-sky-300 tabular-nums">
                  {slot.precipMm.toFixed(1)} mm
                </span>
              ) : (
                <span className="h-3" aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

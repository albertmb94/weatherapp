'use client'

import { useMemo } from 'react'
import type { WeatherModel } from '@/lib/models'
import { useLocale } from '@/lib/LocaleContext'
import { CONDITION_LABEL, STRINGS } from '@/lib/i18n'
import type { DaySummary } from '@/lib/friendlyForecast'
import { computeWeekSummaries } from '@/lib/friendlyForecast'
import WeatherConditionIcon from './WeatherConditionIcon'

interface WeekForecastPanelProps {
  models: WeatherModel[]
  activeIds: string[]
  time: Date[]
  series: Record<string, Record<string, (number | null)[]>>
  startIndex: number
  maxHours: number
  /** Optional selected hour handler so the row feels interactive. */
  onSelectHour?: (hour: number) => void
}

function fmtTemp(value: number | null): string {
  return value === null ? '–' : `${Math.round(value)}°`
}

export default function WeekForecastPanel({
  models,
  activeIds,
  time,
  series,
  startIndex,
  maxHours,
  onSelectHour,
}: WeekForecastPanelProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]

  const days = useMemo<DaySummary[]>(
    () => computeWeekSummaries({ time, series }, models, activeIds, startIndex, maxHours, locale),
    [models, activeIds, time, series, startIndex, maxHours, locale]
  )

  if (days.length === 0) return null

  return (
    <aside
      aria-label={s.weekTitle}
      className="rounded-2xl border border-border bg-surface-raised p-4 md:p-5 lg:sticky lg:top-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold">
          {s.weekTitle}
        </h3>
      </div>
      <ol className="space-y-2.5">
        {days.map((d, i) => (
          <li key={d.fullDate}>
            <button
              type="button"
              onClick={onSelectHour ? () => onSelectHour(startIndex + i * 12) : undefined}
              className="w-full grid grid-cols-[42px_24px_1fr_auto] items-center gap-3 py-1.5 px-1 rounded-md hover:bg-surface-popover/60 transition-colors text-left"
            >
              <span className="text-sm font-medium text-text-primary capitalize">{d.label}</span>
              <span className="flex h-6 w-6 items-center justify-center">
                <WeatherConditionIcon icon={d.icon} size="sm" />
              </span>
              <span className="text-xs text-text-secondary truncate">
                {CONDITION_LABEL[locale][d.icon]}
              </span>
              <span className="flex items-baseline gap-1 tabular-nums whitespace-nowrap">
                <span className="text-sm font-semibold text-text-primary">
                  {fmtTemp(d.highC)}
                </span>
                <span className="text-xs text-text-tertiary">
                  {fmtTemp(d.lowC)}
                </span>
              </span>
            </button>
            {i < days.length - 1 ? (
              <div className="border-b border-border/50 ml-[42px]" />
            ) : null}
          </li>
        ))}
      </ol>
    </aside>
  )
}

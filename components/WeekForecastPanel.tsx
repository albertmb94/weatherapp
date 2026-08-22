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
  /** Index in `time` of the current local hour — drives which day is "today". */
  nowIndex: number
  /** B-NBT-9 (2026-08-22): index in `time` that `onSelectHour` treats as
   *  its origin. The production caller passes `startIndex`, because
   *  `handleHourChange` expects a coordinate relative to the sliced
   *  view — NOT relative to the current hour. Day clicks used to
   *  subtract `nowIndex` (which includes the selected-hour offset) and
   *  landed `selectedHour` hours early, clamping to 0 whenever noon had
   *  already passed. Defaults to 0 for test fixtures where both are
   *  identical anyway. */
  baseIndex?: number
  maxHours: number
  /** Selected range (7 | 14) and the setter so the panel can drive its own toggle. */
  weekDays: 7 | 14
  onWeekDaysChange: (next: 7 | 14) => void
  onSelectHour?: (hour: number) => void
  /** B-NEW-10 (2026-07-25): ensemble mode for the day summaries.
   *  When the Avanzado toggle is on WedAI, the caller passes
   *  `'wedai'` so Próximos días uses the calibrated full ensemble
   *  regardless of which single model the user previously picked
   *  in Models mode. Defaults to `'models'` to preserve the
   *  previous behaviour for callers that haven't been updated
   *  yet. */
  ensembleMode?: 'wedai' | 'models'
}

function fmtTemp(value: number | null): string {
  return value === null ? '–' : `${Math.round(value)}°`
}

export default function WeekForecastPanel({
  models,
  activeIds,
  time,
  series,
  nowIndex,
  baseIndex = 0,
  maxHours,
  weekDays,
  onWeekDaysChange,
  onSelectHour,
  ensembleMode = 'models',
}: WeekForecastPanelProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]

  const days = useMemo<DaySummary[]>(
    () => computeWeekSummaries({ time, series }, models, activeIds, nowIndex, maxHours, locale, weekDays, ensembleMode),
    [models, activeIds, time, series, nowIndex, maxHours, locale, weekDays, ensembleMode]
  )

  if (days.length === 0) return null

  return (
    <aside
      aria-label={s.weekTitle}
      className="rounded-2xl border border-border bg-surface-raised p-4 md:p-5 lg:sticky lg:top-4"
    >
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold">
          {s.weekTitle}
        </h3>
        <div
          role="group"
          aria-label={s.weekTitle}
          className="inline-flex items-center rounded-full border border-border bg-surface p-0.5"
        >
          <button
            type="button"
            onClick={() => onWeekDaysChange(7)}
            aria-pressed={weekDays === 7}
            className={`min-h-[24px] px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
              weekDays === 7
                ? 'bg-accent text-white'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {s.weekOption7}
          </button>
          <button
            type="button"
            onClick={() => onWeekDaysChange(14)}
            aria-pressed={weekDays === 14}
            className={`min-h-[24px] px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
              weekDays === 14
                ? 'bg-accent text-white'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {s.weekOption14}
          </button>
        </div>
      </div>
      <ol className="space-y-2.5">
        {days.map((d, i) => {
          // `noonIndex` is an absolute index into `time`; the caller
          // expects a coordinate relative to `baseIndex` (the origin of
          // its hour state), so the conversion is noon − base. It used
          // to subtract `nowIndex`, which additionally contains the
          // user's selected-hour offset and landed every click that
          // many hours early (clamped to 0 after noon).
          const target = d.noonIndex - baseIndex
          return (
            <li key={d.fullDate}>
              <button
                type="button"
                onClick={onSelectHour ? () => onSelectHour(Math.max(0, target)) : undefined}
                className="w-full grid grid-cols-[42px_24px_1fr_auto] items-center gap-3 py-1.5 px-1 rounded-md hover:bg-surface-popover/60 transition-colors text-left focus-visible:bg-surface-popover/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
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
          )
        })}
      </ol>
    </aside>
  )
}

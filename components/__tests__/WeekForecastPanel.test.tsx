/**
 * B-NBT-9 regression test: day clicks in Próximos días must land at the
 * day's noon relative to `baseIndex` (the origin of the caller's hour
 * state), NOT relative to `nowIndex` (= base + selectedHour). The old
 * math subtracted `nowIndex`, landing every click `selectedHour` hours
 * early and clamping to 0 whenever noon had already passed.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import WeekForecastPanel from '../WeekForecastPanel'
import { LocaleProvider } from '@/lib/LocaleContext'

const START_UTC = Date.UTC(2026, 7, 22, 0, 0)

function makeTimes(hours: number): Date[] {
  return Array.from({ length: hours }, (_, i) => new Date(START_UTC + i * 3600_000))
}

const SERIES = {
  ecmwf_ifs: {
    temperature: Array(400).fill(20),
    precipitation: Array(400).fill(0),
    cloud_cover: Array(400).fill(0),
    wind_gusts: Array(400).fill(0),
  },
} as unknown as Parameters<typeof WeekForecastPanel>[0]['series']

const MODELS = [
  { id: 'ecmwf_ifs', label: 'ECMWF', color: '#000', maxHours: 360, weight: 30, type: 'deterministic' as const, region: 'global' as const },
]

function renderPanel(baseIndex: number, selectedHour: number, onSelectHour: (h: number) => void) {
  const time = makeTimes(384)
  const nowIndex = baseIndex + selectedHour
  return render(
    <LocaleProvider locale="es">
      <WeekForecastPanel
        models={MODELS}
        activeIds={['ecmwf_ifs']}
        time={time}
        series={SERIES}
        nowIndex={nowIndex}
        baseIndex={baseIndex}
        maxHours={nowIndex + 14 * 24}
        weekDays={7}
        onWeekDaysChange={() => {}}
        onSelectHour={onSelectHour}
        ensembleMode="wedai"
      />
    </LocaleProvider>,
  )
}

/** Index of the 12:00 slot for the day that is `dayOffset` days after
 *  the day containing `fromIndex`. Mirrors computeWeekSummaries'
 *  noonIndex semantics closely enough to predict the expected click. */
function expectedNoon(fromIndex: number, dayOffset: number): number {
  const times = makeTimes(384)
  const anchor = new Date(times[fromIndex])
  const targetDayStartUtc = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() + dayOffset)
  for (let i = fromIndex; i < times.length; i++) {
    if (times[i].getTime() >= targetDayStartUtc + 12 * 3600_000 && times[i].getUTCHours() === 12) return i
  }
  throw new Error('noon not found')
}

describe('WeekForecastPanel day clicks (B-NBT-9)', () => {
  afterEach(() => cleanup())

  it('click target does not shift with the user-selected hour', () => {
    const baseIndex = 72 // today starts at 00:00 of 2026-08-25 in the grid
    const targets: number[] = []
    const { unmount } = renderPanel(baseIndex, 10, (h) => targets.push(h))
    // Click the third listed day (index 2 → two days after today).
    const buttons = screen.getAllByRole('button').filter((b) => b.tagName === 'BUTTON' && b.closest('li'))
    expect(buttons.length).toBeGreaterThanOrEqual(3)
    fireEvent.click(buttons[2])
    unmount()

    const { unmount: unmount2 } = renderPanel(baseIndex, 20, (h) => targets.push(h))
    const buttons2 = screen.getAllByRole('button').filter((b) => b.closest('li'))
    fireEvent.click(buttons2[2])
    unmount2()

    expect(targets).toHaveLength(2)
    // Both clicks land on the SAME hour offset — the old code differed
    // by exactly (20 − 10) hours.
    expect(targets[0]).toBe(targets[1])
    expect(targets[0]).toBe(expectedNoon(baseIndex + 10, 2) - baseIndex)
  })

  it('a click after noon still reaches the future day (old code clamped to 0)', () => {
    const calls: number[] = []
    const { unmount } = renderPanel(72, 18, (h) => calls.push(h))
    const buttons = screen.getAllByRole('button').filter((b) => b.closest('li'))
    fireEvent.click(buttons[2])
    unmount()
    expect(calls[0]).toBeGreaterThan(0)
  })
})

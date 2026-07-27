import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CurrentWeatherCard from '../CurrentWeatherCard'
import { LocaleProvider } from '@/lib/LocaleContext'
import type { CurrentSnapshot } from '@/lib/friendlyForecast'

function renderCard(snapshot: CurrentSnapshot | null, props: Partial<React.ComponentProps<typeof CurrentWeatherCard>> = {}) {
  return render(
    <LocaleProvider initialLocale="es">
      <CurrentWeatherCard city="Badalona" snapshot={snapshot} {...props} />
    </LocaleProvider>,
  )
}

describe('CurrentWeatherCard', () => {
  it('renders an em-dash when no snapshot is available', () => {
    const { container } = renderCard(null)
    expect(container.textContent).toContain('–')
  })

  it('renders the calibrated probability when present (no spread chip)', () => {
    // The previous build also rendered a "±X°" spread chip
    // (the ConfidenceChip with the band label) inline here.
    // The user asked us to drop it: the indicator added
    // noise without a corresponding action the user could
    // take. This test pins the new behaviour — the
    // probability is still rendered, the spread chip is not.
    const snapshot = {
      temperatureC: 22,
      feelsLikeC: 22,
      windKmh: 10,
      windGustsKmh: 18,
      precipitationMm: 0.5,
      chanceOfRainPct: 24,
      precipitationProbabilityPct: 24,
      uvIndex: null,
      uvIndexPeak: null,
      cloudCoverPct: 60,
      humidityPct: 70,
      icon: 'rainy' as const,
      conditionLabel: 'conditionRainy' as const,
      dailyHighC: 24,
      dailyLowC: 18,
      spread: { stdDev: 1.2, min: 21, max: 23, range: 2, sampleCount: 5 },
    }
    const { container } = renderCard(snapshot)
    expect(screen.getByText('24%')).toBeInTheDocument()
    // The spread marker (the `±` glyph) must NOT be rendered
    // any more. We assert the absence of the typical
    // ConfidenceChip content.
    expect(container.textContent).not.toMatch(/±\d/)
  })

  it('prefers the nowcast temperature over the snapshot when provided', () => {
    const snapshot = {
      temperatureC: 20, feelsLikeC: null, windKmh: null, windGustsKmh: null,
      precipitationMm: null, chanceOfRainPct: null,
      precipitationProbabilityPct: null,
      uvIndex: null, uvIndexPeak: null, cloudCoverPct: null, humidityPct: null,
      icon: 'sunny' as const, conditionLabel: 'conditionSunny' as const,
      dailyHighC: null, dailyLowC: null, spread: null,
    }
    renderCard(snapshot, { nowcastTemperatureC: 21 })
    expect(screen.getByText('21°')).toBeInTheDocument()
  })

  it('renders the weekday label when a wall-clock ms is provided', () => {
    const snapshot = {
      temperatureC: 20, feelsLikeC: null, windKmh: null, windGustsKmh: null,
      precipitationMm: null, chanceOfRainPct: null,
      precipitationProbabilityPct: null,
      uvIndex: null, uvIndexPeak: null, cloudCoverPct: null, humidityPct: null,
      icon: 'sunny' as const, conditionLabel: 'conditionSunny' as const,
      dailyHighC: null, dailyLowC: null, spread: null,
    }
    // 2026-07-26 is a Sunday in UTC.
    const wallClock = Date.UTC(2026, 6, 26, 12, 0, 0)
    renderCard(snapshot, { wallClockMs: wallClock })
    expect(screen.getByText(/domingo/i)).toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import AirConditionsGrid from '../AirConditionsGrid'
import { LocaleProvider } from '@/lib/LocaleContext'
import type { CurrentSnapshot } from '@/lib/friendlyForecast'

function renderGrid(props: Partial<React.ComponentProps<typeof AirConditionsGrid>> = {}) {
  return render(
    <LocaleProvider initialLocale="es">
      <AirConditionsGrid snapshot={null} {...props} />
    </LocaleProvider>,
  )
}

const baseSnapshot: CurrentSnapshot = {
  temperatureC: 22,
  feelsLikeC: 22,
  windKmh: 12,
  windGustsKmh: 18,
  precipitationMm: 0.2,
  chanceOfRainPct: 18,
  precipitationProbabilityPct: 18,
  uvIndex: 4,
  uvIndexPeak: 6,
  cloudCoverPct: 50,
  humidityPct: 60,
  icon: 'cloudy',
  conditionLabel: 'conditionCloudy',
  dailyHighC: 25,
  dailyLowC: 17,
  spread: null,
}

describe('AirConditionsGrid', () => {
  it('cycles the rain tile through chance → intensity → day → chance', () => {
    const { container } = renderGrid({ snapshot: baseSnapshot, dailyPrecipitationSum: [3.4] })
    // Initial mode is 'chance' — expect the calibrated probability.
    expect(container.textContent).toContain('18%')
    // Click the rain tile three times and walk through all modes.
    const rainTiles = Array.from(container.querySelectorAll('button')).filter(b =>
      b.textContent?.includes('Prob') || b.textContent?.includes('Total hoy'),
    )
    const tile = rainTiles[0]
    expect(tile).toBeDefined()
    fireEvent.click(tile!)
    expect(container.textContent).toContain('Intensidad')
    fireEvent.click(tile!)
    expect(container.textContent).toContain('Total hoy')
    fireEvent.click(tile!)
    expect(container.textContent).toContain('Prob')
  })

  it('renders the "Total hoy" tile with the daily mm when sum is present', () => {
    const { container } = renderGrid({ snapshot: baseSnapshot, dailyPrecipitationSum: [4.6] })
    const tiles = container.querySelectorAll('button')
    // Click the rain tile twice to reach "day" mode.
    const rainTile = Array.from(tiles).find(b => b.textContent?.includes('Prob'))
    expect(rainTile).toBeDefined()
    fireEvent.click(rainTile!)
    fireEvent.click(rainTile!)
    expect(container.textContent).toContain('Total hoy')
    expect(container.textContent).toContain('4.6')
  })

  it('renders a graceful em-dash when no daily sum is available', () => {
    const { container } = renderGrid({ snapshot: baseSnapshot })
    const rainTile = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Prob'))
    expect(rainTile).toBeDefined()
    fireEvent.click(rainTile!)
    fireEvent.click(rainTile!)
    expect(container.textContent).toContain('Total hoy')
    expect(container.textContent).toContain('–')
  })

  // F5 (revised): the EU AQI tile lives inside the Métricas
  // block on every viewport. The previous build used a
  // green-on-green pill (text-emerald-200 on bg-emerald-500/15)
  // that the user reported was unreadable. The new tile renders
  // the band label as a band-coloured sub-line on the standard
  // surface-raised background, which is always readable.
  it('renders the EU AQI tile with the headline value and the band label', () => {
    const { container } = renderGrid({ snapshot: baseSnapshot, europeanAqi: 32 })
    expect(container.textContent).toContain('Calidad del aire')
    expect(container.textContent).toContain('32')
    // Band label for AQI 32 is "Aceptable" (es locale).
    expect(container.textContent).toContain('Aceptable')
  })

  it('keeps the EU AQI tile at 2 lines (band label inline with the value)', () => {
    // F5 (third pass): the band label used to live on its
    // own sub-line below the value, making this card
    // taller than the other tiles. It now sits inline
    // with the value (e.g. "32 AQI · Aceptable") so the
    // tile is 2 lines tall, matching the other tiles.
    const { container } = renderGrid({ snapshot: baseSnapshot, europeanAqi: 32 })
    const tiles = Array.from(container.querySelectorAll('section [aria-label="Métricas"], [aria-label="Métricas"]'))
    // Fallback: just find the EU AQI block by its label.
    const tile = Array.from(container.querySelectorAll('div, button')).find(el => {
      const txt = el.textContent ?? ''
      return txt.startsWith('Calidad del aire') && txt.includes('32')
    })
    expect(tile).toBeDefined()
    const children = Array.from(tile!.children)
    expect(children.length).toBe(2)
  })

  it('omits the EU AQI tile when europeanAqi is null', () => {
    const { container } = renderGrid({ snapshot: baseSnapshot, europeanAqi: null })
    expect(container.textContent).not.toContain('Calidad del aire')
  })

  // F5 (revised, second pass): the pollen tile toggles
  // between grass and birch on tap. The default mode is
  // grass (per the component's local state).
  //
  // F5 (third pass): the active mode label (Gramíneas /
  // Abedul) used to live on its own sub-line below the
  // value. It now sits inline with the "Polen" header so
  // the card keeps the same 2-line height as the other
  // tiles. The tests below use a regex matcher that
  // doesn't care about layout, so they still cover the
  // same user-facing behaviour.
  it('renders the pollen tile with the grass reading by default', () => {
    const { container } = renderGrid({
      snapshot: baseSnapshot,
      grassPollen: 12,
      birchPollen: 3,
    })
    expect(container.textContent).toContain('Polen')
    expect(container.textContent).toContain('12')
    expect(container.textContent).toContain('Gramíneas')
    expect(container.textContent).not.toContain('Abedul')
  })

  it('toggles the pollen tile between grass and birch on tap', () => {
    const { container } = renderGrid({
      snapshot: baseSnapshot,
      grassPollen: 12,
      birchPollen: 3,
    })
    const tile = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Polen'))
    expect(tile).toBeDefined()
    fireEvent.click(tile!)
    // After tap: mode flips to "birch", value is 3, label is
    // "Abedul" (es locale).
    expect(container.textContent).toContain('3')
    expect(container.textContent).toContain('Abedul')
    expect(container.textContent).not.toContain('Gramíneas')
    fireEvent.click(tile!)
    // Tap back: grass mode.
    expect(container.textContent).toContain('12')
    expect(container.textContent).toContain('Gramíneas')
  })

  it('keeps the pollen tile at 2 lines (header + value, no sub-line)', () => {
    // Regression test for the third pass: the pollen tile
    // used to render a third sub-line (the mode label) that
    // pushed the second-row cards ~30% taller than the
    // first-row ones. The mode label now lives in the header.
    const { container } = renderGrid({
      snapshot: baseSnapshot,
      grassPollen: 12,
      birchPollen: 3,
    })
    const tile = container.querySelector('button[title*="Toca para alternar"]')
    expect(tile).toBeDefined()
    // The tile must have a 2-line visual structure: the
    // header row (icon + "Polen" + mode) and the value row
    // (number + unit). A third "span" would be the dropped
    // sub-line.
    const children = Array.from(tile!.children)
    expect(children.length).toBe(2)
  })

  it('omits the pollen tile when both readings are null', () => {
    const { container } = renderGrid({
      snapshot: baseSnapshot,
      grassPollen: null,
      birchPollen: null,
    })
    expect(container.textContent).not.toContain('Polen')
  })
})

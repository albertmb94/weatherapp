import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import WeatherConditionIcon from '@/components/WeatherConditionIcon'
import { WEATHER_ICON_IDS, type WeatherIconId } from '@/lib/weatherIcon'

describe('WeatherConditionIcon (B-NEW-9)', () => {
  it('renders an SVG for every WeatherIconId', () => {
    for (const id of WEATHER_ICON_IDS) {
      const { container, unmount } = render(<WeatherConditionIcon icon={id} />)
      const svg = container.querySelector('svg')
      expect(svg, `expected an svg for ${id}`).toBeTruthy()
      unmount()
    }
  })

  it('falls back to a placeholder span for an unknown id', () => {
    // We can't actually pass a bogus id via the typed prop, so we
    // simulate it through `as unknown as WeatherIconId`.
    const { container } = render(
      <WeatherConditionIcon icon={'unknown' as unknown as WeatherIconId} />
    )
    // No <svg> for an unknown id, but the wrapper span remains.
    expect(container.querySelector('svg')).toBeNull()
    expect(container.firstChild).toBeTruthy()
  })

  it('respects the size prop', () => {
    const { container: sm } = render(<WeatherConditionIcon icon="sunny" size="sm" />)
    // size="sm" overrides the svg width via the wrapper class.
    const wrapperSm = sm.firstChild as HTMLElement
    expect(wrapperSm.className).toContain('w-4')

    const { container: md } = render(<WeatherConditionIcon icon="sunny" size="md" />)
    // size="md" keeps the svg's intrinsic w-5 class (no override).
    const svgMd = md.querySelector('svg')
    expect(svgMd?.className.baseVal).toContain('w-5')
  })
})
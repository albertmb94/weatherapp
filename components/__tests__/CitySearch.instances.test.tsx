/**
 * CitySearch mounts TWICE on the home page — once in the mobile header
 * and once in the sticky desktop one — and CSS hides whichever doesn't
 * belong to the current breakpoint.
 *
 * The input used to carry a hard-coded `id="city-search-input"`, so the
 * page shipped two elements sharing an id (invalid HTML) and every
 * `document.getElementById` lookup resolved to the FIRST one in the
 * document — the mobile input, which is `display: none` on desktop.
 * Clicking the × in the desktop header therefore moved focus to an
 * invisible element instead of back to the search box in use.
 *
 * These tests mount two instances, the way the home page does, because
 * a single-instance test cannot see the bug at all.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CitySearch, { focusVisibleCitySearch } from '../CitySearch'
import { LocaleProvider } from '@/lib/LocaleContext'

function renderTwoInstances() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider locale="es">
        {/* Same order as app/home-content.tsx: mobile header first. */}
        <CitySearch onSelect={() => {}} />
        <CitySearch onSelect={() => {}} />
      </LocaleProvider>
    </QueryClientProvider>,
  )
  const [mobile, desktop] = screen.getAllByPlaceholderText(/Search/i) as HTMLInputElement[]
  return { mobile, desktop }
}

/** Make an element look laid-out to jsdom, which has no layout engine. */
function fakeVisible(el: Element) {
  const rect = { x: 0, y: 0, width: 200, height: 36, top: 0, left: 0, right: 200, bottom: 36 }
  el.getClientRects = () => [rect] as unknown as DOMRectList
}

describe('CitySearch — two instances on one page', () => {
  afterEach(cleanup)

  it('gives each instance its own id (no duplicate ids in the document)', () => {
    const { mobile, desktop } = renderTwoInstances()
    expect(mobile.id).toBeTruthy()
    expect(desktop.id).toBeTruthy()
    expect(mobile.id).not.toBe(desktop.id)

    // Nothing in the rendered tree may reuse an id.
    const ids = Array.from(document.querySelectorAll('[id]')).map(el => el.id)
    expect(ids).toHaveLength(new Set(ids).size)
  })

  it('clearing the SECOND instance returns focus to that instance, not the first', () => {
    const { mobile, desktop } = renderTwoInstances()

    act(() => {
      fireEvent.change(desktop, { target: { value: 'B' } })
    })

    // Only the instance with text renders a clear button.
    const clear = screen.getByTestId('city-search-clear')
    act(() => {
      fireEvent.click(clear)
    })

    expect(desktop.value).toBe('')
    // The regression: focus used to land on the first input in the
    // document, which on desktop is the hidden mobile one.
    expect(document.activeElement).toBe(desktop)
    expect(document.activeElement).not.toBe(mobile)
  })

  it('the "/" shortcut focuses the rendered input, not the hidden one', () => {
    const { mobile, desktop } = renderTwoInstances()
    // Desktop breakpoint: the mobile header is `display: none`, so it
    // reports no client rects; the desktop input is laid out.
    fakeVisible(desktop)

    focusVisibleCitySearch()

    expect(document.activeElement).toBe(desktop)
    expect(document.activeElement).not.toBe(mobile)
  })

  it('the "/" shortcut falls back to the first input when nothing reports layout', () => {
    // jsdom has no layout engine, so every element reports zero rects.
    // The helper must still focus something rather than no-op.
    const { mobile } = renderTwoInstances()
    focusVisibleCitySearch()
    expect(document.activeElement).toBe(mobile)
  })
})

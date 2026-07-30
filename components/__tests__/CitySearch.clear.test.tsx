/**
 * B-NEW-29 (2026-07-30): the new × clear button in the
 * search input. The previous UX forced the user to select-all
 * + delete (or hold backspace) to start a fresh search,
 * which on a 393 px mobile viewport was awkward. We now show
 * a small × inside the input on the right edge whenever
 * `query` is non-empty; clicking it resets the field, closes
 * the dropdown, and returns focus to the input.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CitySearch from '../CitySearch'
import { LocaleProvider } from '@/lib/LocaleContext'

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // The inner component is named `Wrapper` so the ESLint
  // `react/display-name` rule is happy. We can't pass
  // `displayName` on a function component, so the function
  // name is the only knob we have.
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <LocaleProvider initialLocale="es">{children}</LocaleProvider>
      </QueryClientProvider>
    )
  }
  return { qc, Wrapper }
}

describe('CitySearch — clear (×) button (B-NEW-29)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('does NOT render the clear button when the input is empty', () => {
    const { Wrapper } = makeWrapper()
    render(
      <Wrapper>
        <CitySearch onSelect={() => {}} />
      </Wrapper>,
    )
    expect(screen.queryByTestId('city-search-clear')).toBeNull()
  })

  it('renders the clear button as soon as the user types something', () => {
    const { Wrapper } = makeWrapper()
    render(
      <Wrapper>
        <CitySearch onSelect={() => {}} />
      </Wrapper>,
    )
    const input = screen.getByPlaceholderText(/Search/i) as HTMLInputElement
    act(() => {
      fireEvent.change(input, { target: { value: 'Bar' } })
    })
    const clear = screen.getByTestId('city-search-clear')
    expect(clear).not.toBeNull()
  })

  it('clicking the clear button resets the input value and refocuses it', () => {
    const { Wrapper } = makeWrapper()
    render(
      <Wrapper>
        <CitySearch onSelect={() => {}} />
      </Wrapper>,
    )
    const input = screen.getByPlaceholderText(/Search/i) as HTMLInputElement
    act(() => {
      fireEvent.change(input, { target: { value: 'Barcelona' } })
    })
    expect(input.value).toBe('Barcelona')

    const clear = screen.getByTestId('city-search-clear')
    act(() => {
      fireEvent.click(clear)
    })

    // Input was reset
    expect(input.value).toBe('')
    // Clear button is gone now that the field is empty
    expect(screen.queryByTestId('city-search-clear')).toBeNull()
    // Focus is back on the input
    expect(document.activeElement).toBe(input)
  })

  it('clicking the clear button does NOT fire onSelect', () => {
    const onSelect = vi.fn()
    const { Wrapper } = makeWrapper()
    render(
      <Wrapper>
        <CitySearch onSelect={onSelect} />
      </Wrapper>,
    )
    const input = screen.getByPlaceholderText(/Search/i) as HTMLInputElement
    act(() => {
      fireEvent.change(input, { target: { value: 'Bar' } })
    })
    act(() => {
      fireEvent.click(screen.getByTestId('city-search-clear'))
    })
    expect(onSelect).not.toHaveBeenCalled()
  })
})

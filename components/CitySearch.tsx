'use client'

import { useState, useRef, useEffect, useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import { fetchWithTimeout } from '@/lib/fetchWithTimeout'

interface GeocodeResult {
  id: number
  name: string
  latitude: number
  longitude: number
  country?: string
  admin1?: string
}

interface CitySearchProps {
  onSelect: (name: string, lat: number, lon: number) => void
}

// Focus whichever search input is actually on screen.
//
// The home page mounts CitySearch twice — once in the mobile header,
// once in the sticky desktop one — and CSS hides one of them per
// breakpoint. Callers outside the component (the "/" shortcut) used to
// reach the input through a shared `id`, which always resolved to the
// mobile instance and so focused a `display: none` element on desktop.
export function focusVisibleCitySearch() {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('[data-city-search-input]'),
  )
  // A `display: none` element has no client rects — that is what tells
  // the hidden header apart from the rendered one. Environments without
  // layout (jsdom) report zero rects for everything, so fall back to the
  // first input instead of leaving the shortcut dead there.
  const target = inputs.find(el => el.getClientRects().length > 0) ?? inputs[0]
  target?.focus()
}

export default function CitySearch({ onSelect }: CitySearchProps) {
  const { locale } = useLocale()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suppressAutoOpenRef = useRef(false)
  // The component mounts TWICE on the home page (the mobile header and
  // the sticky desktop one), so a hard-coded id produced two elements
  // sharing it — invalid HTML, and `getElementById` always resolved to
  // the mobile one, which is `display: none` on desktop. `useId` gives
  // each instance its own id, and focus goes through `inputRef` below.
  const inputId = useId()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.length < 2) {
      debounceRef.current = setTimeout(() => setDebouncedQuery(''), 150)
      return
    }
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const { data: results = [], isFetching } = useQuery<GeocodeResult[]>({
    queryKey: ['geocode', debouncedQuery, locale],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        name: debouncedQuery,
        count: '5',
        language: locale === 'en' ? 'en' : 'es',
        format: 'json',
      })
      const res = await fetchWithTimeout(`/api/geocode?${params}`, { signal, timeoutMs: 8000 })
      if (!res.ok) return []
      const data = await res.json()
      return data.results ?? []
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  // Open the dropdown when results arrive, unless suppressed after selection.
  useEffect(() => {
    if (results.length > 0 && !suppressAutoOpenRef.current) {
      setIsOpen(true)
    }
  }, [results])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    // User typed something new → re-enable auto-open.
    suppressAutoOpenRef.current = false
    if (val.length < 2) {
      setIsOpen(false)
    }
  }

  function handleSelect(r: GeocodeResult) {
    suppressAutoOpenRef.current = true
    setQuery(r.name)
    setDebouncedQuery('')
    setIsOpen(false)
    onSelect(r.name, r.latitude, r.longitude)
  }

  // B-NEW-29 (2026-07-30): one-tap clear for the search field.
  // The previous UX forced the user to select-all + delete (or
  // hold backspace) to start a fresh search, which on a 393 px
  // mobile viewport was annoying — the keyboard eats half the
  // screen and selecting text is fiddly. We show a small ×
  // inside the input on the right edge whenever `query` is
  // non-empty; clicking it resets both the visible text and
  // the debounced query (so an in-flight geocode request gets
  // cancelled on the next render), closes the dropdown, and
  // returns focus to the input so the user can keep typing.
  function handleClear() {
    setQuery('')
    setDebouncedQuery('')
    setIsOpen(false)
    suppressAutoOpenRef.current = true
    // Cancel any pending debounce timer so a stale request
    // doesn't fire after the clear and re-open the dropdown.
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // Focus THIS instance's input via the ref. The old
    // `getElementById('city-search-input')` returned the first
    // match in the document, so pressing × in the desktop header
    // moved focus to the hidden mobile input instead.
    inputRef.current?.focus()
  }

  return (
    <div ref={wrapperRef} className="relative w-full">
      <input
        ref={inputRef}
        id={inputId}
        // Stable hook for the global "/" shortcut and for E2E: the id
        // is per-instance now, so callers outside this component look
        // up the *rendered* input by this attribute instead.
        data-city-search-input=""
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={() => { if (results.length > 0) setIsOpen(true) }}
        placeholder={STRINGS[locale].searchPlaceholder}
        // Bump right padding from pr-3 → pr-9 so the typed text
        // never slides under the new clear button (or the
        // existing spinner). The clear button reserves the right
        // 28 px so the user's last character stays readable.
        className="w-full min-w-0 pl-9 pr-9 py-2 bg-surface-popover text-text-primary text-sm rounded-lg placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 border border-border transition-colors"
      />
      {isFetching && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="w-3 h-3 border-2 border-text-tertiary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {query.length > 0 && !isFetching && (
        <button
          type="button"
          onClick={handleClear}
          aria-label={STRINGS[locale].clearSearch}
          data-testid="city-search-clear"
          // The button sits where the spinner would be (right
          // edge) so the input never has two adornments fighting
          // for the same slot. 24 × 24 keeps the touch target
          // above the 36 px Material minimum (the parent
          // container stretches to min-h-9 = 36 px).
          className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[24px] min-h-[24px] flex items-center justify-center rounded-full text-text-tertiary hover:text-text-primary hover:bg-surface-raised/60 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
      {isOpen && results.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-surface-popover border border-border rounded-lg shadow-lg max-h-48 overflow-auto animate-fadeIn">
          {results.map(r => (
            <li
              key={r.id}
              onClick={() => handleSelect(r)}
              className="px-3 py-2 cursor-pointer hover:bg-surface text-text-primary text-sm transition-colors"
            >
              <span>{r.name}</span>
              {r.country && <span className="text-text-tertiary">, {r.country}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

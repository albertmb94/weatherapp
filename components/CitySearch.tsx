'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from '@/lib/LocaleContext'
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

export default function CitySearch({ onSelect }: CitySearchProps) {
  const { locale } = useLocale()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const suppressAutoOpenRef = useRef(false)

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

  return (
    <div ref={wrapperRef} className="relative w-full">
      <input
        id="city-search-input"
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={() => { if (results.length > 0) setIsOpen(true) }}
        placeholder="Search..."
        className="w-full min-w-0 pl-9 pr-3 py-2 bg-surface-popover text-text-primary text-sm rounded-lg placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 border border-border transition-colors"
      />
      {isFetching && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="w-3 h-3 border-2 border-text-tertiary border-t-transparent rounded-full animate-spin" />
        </div>
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

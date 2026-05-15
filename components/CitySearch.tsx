'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

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
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [loading, setLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const abortRef = useRef<AbortController | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const search = useCallback(async (q: string, signal: AbortSignal) => {
    if (q.length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({
        name: q,
        count: '5',
        language: 'en',
        format: 'json',
      })
      const res = await fetch(`/api/geocode?${params}`, { signal })
      if (!res.ok) return
      const data = await res.json()
      if (signal.aborted) return
      setResults(data.results ?? [])
      setIsOpen(true)
    } catch {
      if (!signal.aborted) setResults([])
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    if (abortRef.current) abortRef.current.abort()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const controller = new AbortController()
    abortRef.current = controller
    debounceRef.current = setTimeout(() => search(val, controller.signal), 300)
  }

  function handleSelect(r: GeocodeResult) {
    setQuery(r.name)
    setIsOpen(false)
    if (abortRef.current) abortRef.current.abort()
    onSelect(r.name, r.latitude, r.longitude)
  }

  return (
    <div ref={wrapperRef} className="relative w-48">
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={() => { if (results.length > 0) setIsOpen(true) }}
        placeholder="Search city..."
        className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />
      {loading && (
        <div className="absolute right-2 top-2">
          <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {isOpen && results.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-auto">
          {results.map(r => (
            <li
              key={r.id}
              onClick={() => handleSelect(r)}
              className="px-2 py-1.5 cursor-pointer hover:bg-gray-700 text-white text-sm"
            >
              <span>{r.name}</span>
              {r.country && <span className="text-gray-400">, {r.country}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

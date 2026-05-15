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
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={() => { if (results.length > 0) setIsOpen(true) }}
        placeholder="Search..."
        className="w-36 px-2 py-1 bg-transparent text-white text-xs placeholder-gray-600 focus:outline-none focus:placeholder-gray-400 transition-colors"
      />
      {loading && (
        <div className="absolute right-1 top-1.5">
          <div className="w-2.5 h-2.5 border border-gray-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {isOpen && results.length > 0 && (
        <ul className="absolute z-50 w-48 mt-1 bg-gray-900 border border-gray-800 rounded-md shadow-lg max-h-48 overflow-auto animate-fadeIn">
          {results.map(r => (
            <li
              key={r.id}
              onClick={() => handleSelect(r)}
              className="px-2 py-1.5 cursor-pointer hover:bg-gray-800 text-white text-xs transition-colors"
            >
              <span>{r.name}</span>
              {r.country && <span className="text-gray-500">, {r.country}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

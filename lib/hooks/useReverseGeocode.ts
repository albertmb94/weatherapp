'use client'

import { useEffect, useRef, useState } from 'react'

export interface ReverseGeocode {
  name: string
  country?: string
  /** Monotonic counter to detect out-of-order responses from older
   *  fetch calls racing against newer ones. */
  seq: number
}

interface ReverseGeocodeState {
  name: string
  country?: string
  /** True while the most recent fetch is in flight. */
  isFetching: boolean
  /** Monotonic counter (0 when nothing has been fetched yet). */
  seq: number
}

/**
 * Debounced reverse-geocode for `(lat, lon)` coordinates. Returns the
 * most recent successful resolution; race-conditions between old and
 * new fetches are resolved by `seq` so a slow older request cannot
 * overwrite a fresher one.
 *
 * Replaces the three ad-hoc `useEffect` blocks that lived in
 * `home-content.tsx` (and one variant in `CitySearch.tsx`) before S4.
 */
export function useReverseGeocode(
  lat: number | null,
  lon: number | null,
  locale: string,
  debounceMs: number = 350
): ReverseGeocodeState {
  const [state, setState] = useState<ReverseGeocodeState>({
    name: '',
    isFetching: false,
    seq: 0,
  })
  const seqRef = useRef(0)

  useEffect(() => {
    if (lat === null || lon === null) {
      setState({ name: '', isFetching: false, seq: seqRef.current })
      return
    }
    const mySeq = ++seqRef.current
    setState((prev) => ({ ...prev, isFetching: true, seq: mySeq }))
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ lat: lat.toString(), lon: lon.toString(), locale })
        const res = await fetch(`/api/reverse-geocode?${params.toString()}`)
        const data = await res.json()
        if (seqRef.current !== mySeq) return
        if (!res.ok || !data?.name) {
          setState({ name: '', isFetching: false, seq: mySeq })
          return
        }
        setState({ name: data.name, country: data.country, isFetching: false, seq: mySeq })
      } catch {
        if (seqRef.current !== mySeq) return
        setState({ name: '', isFetching: false, seq: mySeq })
      }
    }, debounceMs)

    return () => clearTimeout(handle)
  }, [lat, lon, locale, debounceMs])

  return state
}

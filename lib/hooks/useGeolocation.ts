'use client'

import { useCallback, useState } from 'react'

export interface GeolocationRequest {
  status: 'idle' | 'pending' | 'granted' | 'denied' | 'unavailable'
  /** Latest (lat, lon) the user has shared. */
  position?: [number, number]
}

/**
 * Imperative wrapper around `navigator.geolocation.getCurrentPosition`.
 * Calls the underlying API with `{ enableHighAccuracy: false, timeout: 10s, maximumAge: 5min }`
 * to stay snappy on slow connections.
 *
 * Replaces the inline `handleGeolocate` callback in `home-content.tsx`
 * (the original implementation lacked an inflight flag and ran two
 * concurrent requests when the user double-tapped the pin button).
 */
export function useGeolocation(): GeolocationRequest & { request: () => void } {
  const [state, setState] = useState<GeolocationRequest>({ status: 'idle' })

  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ status: 'unavailable' })
      return
    }
    setState((prev) =>
      prev.status === 'pending'
        ? prev
        : { status: 'pending', ...(prev.position && { position: prev.position }) }
    )
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          status: 'granted',
          position: [pos.coords.latitude, pos.coords.longitude],
        })
      },
      (err) => {
        setState((prev) => ({
          status: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable',
          ...(prev.position && { position: prev.position }),
        }))
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    )
  }, [])

  return { ...state, request }
}

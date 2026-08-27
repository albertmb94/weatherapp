'use client'

import { useEffect, useRef } from 'react'

/**
 * Returns a stable function that defers calling `fn` until `delayMs`
 * have elapsed since the last invocation. Useful for debouncing
 * URL state writes, search box updates, etc.
 *
 * Replaces ad-hoc `setTimeout`/`clearTimeout` pairs that lived in
 * 4+ places before S4 (CitySearch, StationDashboard, MapPicker, the
 * URL-state effect inside `useUrlState`).
 *
 * The returned function also cancels the pending timer when invoked
 * with no arguments, so callers can use it as both `debounced(...)`
 * and `debounced.cancel()`.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number
): ((...args: Args) => void) & { cancel: () => void } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callback = useRef(fn)

  // Always read the latest callback without re-creating the debounced
  // wrapper. This is what lets the caller include `fn` in deps arrays
  // upstream without invalidating the debounced reference.
  useEffect(() => {
    callback.current = fn
  }, [fn])

  function debounced(...args: Args) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      callback.current(...args)
    }, delayMs)
  }

  debounced.cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  useEffect(() => () => debounced.cancel(), [])

  return debounced
}

'use client'

import { useEffect } from 'react'

/**
 * Calls `onOutside` whenever a pointer or touch event lands outside
 * any of the supplied `refs`.
 *
 * `active` defaults to `true` so call sites that should listen
 * unconditionally can pass just `(ref, onOutside)`. When
 * `active` is false the listener is detached, which is the expected
 * behaviour for "close on esc/click outside" dropdowns that have
 * been dismissed by a parent component.
 *
 * Replaces the three hand-rolled implementations that lived in
 * `home-content.tsx`, `CitySearch.tsx` and `ModelSelector.tsx`
 * before S4 — each one had subtle differences (touchstart support,
 * listener cleanup, conditional activation).
 */
export function useClickOutside(
  refs: React.RefObject<HTMLElement | null> | React.RefObject<HTMLElement | null>[],
  onOutside: (event: MouseEvent | TouchEvent) => void,
  active: boolean = true
): void {
  useEffect(() => {
    if (!active) return
    const list = Array.isArray(refs) ? refs : [refs]
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null
      if (!target) return
      const inside = list.some(r => r.current?.contains(target))
      if (!inside) onOutside(event)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [refs, onOutside, active])
}

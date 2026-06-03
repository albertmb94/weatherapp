'use client'

import { useRef, useCallback, useEffect } from 'react'

interface UseSwipeOptions {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  threshold?: number
}

export function useSwipeGesture<T extends HTMLElement>({
  onSwipeLeft,
  onSwipeRight,
  threshold = 40,
}: UseSwipeOptions) {
  const ref = useRef<T>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const tracking = useRef(false)

  const onTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0]
    startX.current = touch.clientX
    startY.current = touch.clientY
    tracking.current = true
  }, [])

  const onTouchEnd = useCallback((e: TouchEvent) => {
    if (!tracking.current) return
    tracking.current = false
    const touch = e.changedTouches[0]
    const dx = touch.clientX - startX.current
    const dy = touch.clientY - startY.current
    if (Math.abs(dx) < threshold) return
    if (Math.abs(dy) > Math.abs(dx)) return
    if (dx < 0) onSwipeLeft?.()
    else onSwipeRight?.()
  }, [onSwipeLeft, onSwipeRight, threshold])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [onTouchStart, onTouchEnd])

  return ref
}

'use client'

import { useRef, useCallback, useEffect, useState } from 'react'

interface UsePullToRefreshOptions {
  onRefresh: () => void | Promise<void>
  threshold?: number
  disabled?: boolean
}

export function usePullToRefresh<T extends HTMLElement>({
  onRefresh,
  threshold = 80,
  disabled = false,
}: UsePullToRefreshOptions) {
  const ref = useRef<T>(null)
  const startY = useRef(0)
  const pulling = useRef(false)
  const [pullDistance, setPullDistance] = useState(0)
  // Returns a callback ref the caller should pass to the target div. The
  // callback ref lets us keep a stable ref and stay lint-clean
  // (the new react-hooks/refs rule bans writing .current during render).
  const setRef = useCallback((el: T | null) => {
    ref.current = el
  }, [])
  const [refreshing, setRefreshing] = useState(false)

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || refreshing) return
    const el = ref.current
    if (!el || el.scrollTop > 0) return
    startY.current = e.touches[0].clientY
    pulling.current = true
  }, [disabled, refreshing])

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!pulling.current) return
    const dy = e.touches[0].clientY - startY.current
    if (dy < 0) {
      setPullDistance(0)
      return
    }
    setPullDistance(Math.min(dy, threshold * 1.5))
  }, [threshold])

  const onTouchEnd = useCallback(async () => {
    if (!pulling.current) return
    pulling.current = false
    if (pullDistance >= threshold) {
      setRefreshing(true)
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
      }
    }
    setPullDistance(0)
  }, [pullDistance, threshold, onRefresh])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [onTouchStart, onTouchMove, onTouchEnd])

  return { ref: setRef, pullDistance, refreshing }
}

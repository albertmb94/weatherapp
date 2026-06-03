'use client'

import { useOnlineStatus } from '@/lib/useOnlineStatus'
import { useState, useEffect, useRef } from 'react'

export default function ConnectionStatus() {
  const online = useOnlineStatus()
  const [show, setShow] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    if (!online) {
      timerRef.current = setTimeout(() => setShow(true), 1000)
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [online])

  // When coming back online, hide immediately
  useEffect(() => {
    if (online) {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setShow(false), 0)
    }
  }, [online])

  if (!show) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[3000] bg-red-600/95 text-white text-xs text-center py-1.5 px-3 animate-fadeIn">
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-red-300 animate-pulse" />
        No internet connection
      </span>
    </div>
  )
}

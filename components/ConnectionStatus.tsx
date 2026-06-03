'use client'

import { useOnlineStatus } from '@/lib/useOnlineStatus'

export default function ConnectionStatus() {
  const online = useOnlineStatus()

  if (online) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[3000] bg-red-600/95 text-white text-xs text-center py-1.5 px-3 animate-fadeIn">
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-red-300 animate-pulse" />
        No internet connection
      </span>
    </div>
  )
}

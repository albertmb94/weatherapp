'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatAge } from '@/lib/formatAge'
import { useLocale } from '@/lib/LocaleContext'
import { useRefresh } from '@/lib/useRefresh'
import { REFRESH_WINDOW_MS } from '@/lib/refreshWindow'

interface RefreshStatus {
  lastRefreshedAt: number | null
  ageMs: number | null
  canRefresh: boolean
  cooldownMs: number
}

export default function RefreshButton() {
  const [feedback, setFeedback] = useState<string | null>(null)
  const { locale } = useLocale()
  const { refresh, isPending, lastOutcome } = useRefresh()

  const { data: status } = useQuery<RefreshStatus>({
    queryKey: ['refresh-status'],
    queryFn: async () => {
      const res = await fetch('/api/refresh')
      if (!res.ok) throw new Error('Failed to fetch refresh status')
      return res.json()
    },
    refetchInterval: () => {
      return typeof document !== 'undefined' && document.visibilityState === 'visible' ? 60_000 : false
    },
    refetchOnWindowFocus: true,
  })

  // S6: show a transient label for the last outcome. After the cooldown
  // the label fades back to the age.
  useEffect(() => {
    if (!lastOutcome) return
    if (lastOutcome.kind === 'refreshed') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFeedback('now')
    } else {
      const mins = Math.max(1, Math.ceil(lastOutcome.remainingMs / 60000))
      setFeedback(`${mins}m`)
    }
    const t = setTimeout(() => setFeedback(null), 3000)
    return () => clearTimeout(t)
  }, [lastOutcome])

  const ageLabel = formatAge(status?.ageMs ?? null, locale)
  // M-UI-3: when the cache is older than the refresh window the data is
  // stale; tint the label so the user notices without reading the icon.
  // Uses the shared `REFRESH_WINDOW_MS` so the badge stays in lockstep
  // with the Turso caches and the manual cooldown.
  const isStale = (status?.ageMs ?? 0) > REFRESH_WINDOW_MS
  const labelColor = feedback ? 'text-emerald-400' : isStale ? 'text-amber-400' : 'text-gray-600'

  return (
    <button
      onClick={refresh}
      disabled={isPending}
      className="px-1.5 py-1 rounded text-[10px] font-medium text-gray-500 hover:text-white transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1"
      title={status?.lastRefreshedAt ? `Last refresh: ${new Date(status.lastRefreshedAt).toLocaleString()}` : 'Never refreshed'}
      aria-label={status?.lastRefreshedAt ? `Last refresh ${ageLabel || 'never'}. Press to refresh.` : 'Press to refresh data.'}
      aria-live="polite"
    >
      {isPending ? (
        <div className="w-2.5 h-2.5 border border-gray-400 border-t-transparent rounded-full animate-spin" />
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      )}
      <span className={labelColor}>{feedback ?? (ageLabel || '')}</span>
    </button>
  )
}

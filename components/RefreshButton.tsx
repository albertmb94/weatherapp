'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface RefreshStatus {
  lastRefreshedAt: number | null
  ageMs: number | null
  canRefresh: boolean
  cooldownMs: number
}

function formatAge(ageMs: number | null): string {
  if (ageMs == null) return ''
  const minutes = Math.floor(ageMs / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export default function RefreshButton() {
  const queryClient = useQueryClient()
  const [feedback, setFeedback] = useState<string | null>(null)

  const { data: status } = useQuery<RefreshStatus>({
    queryKey: ['refresh-status'],
    queryFn: async () => {
      const res = await fetch('/api/refresh')
      if (!res.ok) throw new Error('Failed to fetch refresh status')
      return res.json()
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/refresh', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Refresh failed')
      return data as { skipped: boolean; reason?: string; refreshedAt?: number; ageMs?: number | null }
    },
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: ['refresh-status'] })
      if (result.skipped) {
        const remainingMs = (status?.cooldownMs ?? 0) - (result.ageMs ?? 0)
        const mins = Math.max(1, Math.ceil(remainingMs / 60000))
        setFeedback(`${mins}m`)
      } else {
        queryClient.invalidateQueries({ queryKey: ['forecast'] })
        setFeedback('now')
      }
    },
    onError: err => {
      setFeedback(err instanceof Error ? err.message : 'err')
    },
  })

  useEffect(() => {
    if (!feedback) return
    const t = setTimeout(() => setFeedback(null), 3000)
    return () => clearTimeout(t)
  }, [feedback])

  const ageLabel = formatAge(status?.ageMs ?? null)
  const disabled = refreshMutation.isPending

  return (
    <button
      onClick={() => refreshMutation.mutate()}
      disabled={disabled}
      className="px-1.5 py-1 rounded text-[10px] font-medium text-gray-500 hover:text-white transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1"
      title={status?.lastRefreshedAt ? `Last refresh: ${new Date(status.lastRefreshedAt).toLocaleString()}` : 'Never refreshed'}
    >
      {disabled ? (
        <div className="w-2.5 h-2.5 border border-gray-400 border-t-transparent rounded-full animate-spin" />
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      )}
      <span className="text-gray-600">{feedback ?? (ageLabel || '')}</span>
    </button>
  )
}

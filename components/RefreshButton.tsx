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
  if (ageMs == null) return 'never'
  const minutes = Math.floor(ageMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''} ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
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
        setFeedback(`Skipped — wait ${mins}m`)
      } else {
        // New refresh: invalidate forecast queries so the UI re-fetches.
        queryClient.invalidateQueries({ queryKey: ['forecast'] })
        setFeedback('Refreshed')
      }
    },
    onError: err => {
      setFeedback(err instanceof Error ? err.message : 'Error')
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
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => refreshMutation.mutate()}
        disabled={disabled}
        className="px-2.5 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-600 rounded text-xs text-white cursor-pointer disabled:cursor-not-allowed"
        title={status?.lastRefreshedAt ? `Last refresh: ${new Date(status.lastRefreshedAt).toLocaleString()}` : 'Never refreshed'}
      >
        {disabled ? 'Refreshing…' : 'Refresh'}
      </button>
      <span className="text-[10px] text-gray-500 whitespace-nowrap">
        {feedback ?? ageLabel}
      </span>
    </div>
  )
}

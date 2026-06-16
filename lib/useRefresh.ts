import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

export interface RefreshStatus {
  lastRefreshedAt: number | null
  ageMs: number | null
  canRefresh: boolean
  cooldownMs: number
}

export type RefreshOutcome =
  | { kind: 'refreshed' }
  | { kind: 'cooldown'; remainingMs: number }

export interface UseRefreshResult {
  /** Latest known server status (last fetched, may be slightly stale). */
  status: RefreshStatus | null
  /** Last outcome from a refresh action, exposed for toasts / aria-live. */
  lastOutcome: RefreshOutcome | null
  /** True while the underlying POST /api/refresh is in flight. */
  isPending: boolean
  /** Fire-and-forget refresh: invalidates client queries regardless of
   *  server-side cooldown so the user always sees the latest cached data. */
  refresh: () => void
}

/**
 * S6: shared refresh state. The single mutation:
 *  - POSTs /api/refresh (server-side purges the server cache when the
 *    cooldown allows it, otherwise returns {skipped: true}).
 *  - Always invalidates the data queries so the user gets the latest
 *    data the server has, even when the server was in cooldown.
 *  - Exposes the result as `lastOutcome` so the UI can distinguish
 *    "we got new model data" from "we just reloaded the cached data".
 */
export function useRefresh(): UseRefreshResult {
  const queryClient = useQueryClient()
  const [lastOutcome, setLastOutcome] = useState<RefreshOutcome | null>(null)

  const mutation = useMutation({
    mutationFn: async (): Promise<{ skipped: boolean; reason?: string; refreshedAt?: number; ageMs?: number | null; cooldownMs?: number }> => {
      const res = await fetch('/api/refresh', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Refresh failed')
      return data
    },
    onSuccess: (result) => {
      // S6.4: invalidate every data query so the user sees fresh data
      // regardless of whether the server actually purged (cooldown).
      queryClient.invalidateQueries({ queryKey: ['forecast'] })
      queryClient.invalidateQueries({ queryKey: ['refresh-status'] })
      queryClient.invalidateQueries({ queryKey: ['aemet-stations'] })
      queryClient.invalidateQueries({ queryKey: ['meteocat-stations'] })
      queryClient.invalidateQueries({ queryKey: ['meteoclimatic'] })
      queryClient.invalidateQueries({ queryKey: ['meteoclimatic-coord'] })

      // onSuccess is invoked from the mutation runtime, not from a render
      // or effect, so the `react-hooks/set-state-in-effect` lint rule does
      // not flag this. The rule is overly conservative around async
      // callbacks that happen to be passed to React APIs.
      setLastOutcome(
        result && 'skipped' in result && result.skipped
          ? { kind: 'cooldown' as const, remainingMs: Math.max(0, (result.cooldownMs ?? 0) - (result.ageMs ?? 0)) }
          : { kind: 'refreshed' as const },
      )
    },
  })

  const refresh = useCallback(() => {
    if (mutation.isPending) return // debounce: ignore double-clicks
    mutation.mutate()
  }, [mutation])

  return {
    status: null,
    lastOutcome,
    isPending: mutation.isPending,
    refresh,
  }
}

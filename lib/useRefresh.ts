import { useState, useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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

interface RefreshStatusResponse {
  refreshedAt?: number
  ageMs?: number | null
  canRefresh?: boolean
  cooldownMs?: number
}

/**
 * S4/Sprint 4: centralised refresh state. The single mutation posts
 *  to /api/refresh; the single query keeps the latest known
 *  server-side cooldown visible to every consuming component.
 *
 * Before S4, the same query was repeated in `RefreshButton` and
 * `SettingsPanel`, and the result type was duplicated as
 *  `RefreshStatus` in two places. After S4, every consumer pulls
 *  through this hook and the status is real, not `null`.
 */
export function useRefresh(): UseRefreshResult {
  const queryClient = useQueryClient()
  const [lastOutcome, setLastOutcome] = useState<RefreshOutcome | null>(null)

  const statusQuery = useQuery({
    queryKey: ['refresh-status'],
    queryFn: async (): Promise<RefreshStatus> => {
      const res = await fetch('/api/refresh', { method: 'GET' })
      const data: RefreshStatusResponse = await res.json().catch(() => ({}))
      return {
        lastRefreshedAt: typeof data.refreshedAt === 'number' ? data.refreshedAt : null,
        ageMs: typeof data.ageMs === 'number' ? data.ageMs : null,
        canRefresh: Boolean(data.canRefresh),
        cooldownMs: typeof data.cooldownMs === 'number' ? data.cooldownMs : 0,
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })

  const mutation = useMutation({
    mutationFn: async (): Promise<RefreshStatusResponse> => {
      const res = await fetch('/api/refresh', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Refresh failed')
      return data as RefreshStatusResponse
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['forecast'] })
      queryClient.invalidateQueries({ queryKey: ['refresh-status'] })
      // onSuccess is invoked from the mutation runtime, not from a
      // render or effect, so `setLastOutcome` doesn't trip
      // `react-hooks/set-state-in-effect`.
      setLastOutcome(
        result && 'skipped' in result && result.skipped
          ? {
              kind: 'cooldown' as const,
              remainingMs: Math.max(0, (result.cooldownMs ?? 0) - (result.ageMs ?? 0)),
            }
          : { kind: 'refreshed' as const },
      )
    },
  })

  // AUDITORÍA: la dependencia era `[mutation]`, y react-query devuelve un
  // objeto de mutación NUEVO en cada render, así que `refresh` cambiaba
  // de identidad continuamente. Ese valor alimenta
  // `usePullToRefresh({ onRefresh: refresh })`, cuyo efecto de listeners
  // depende de los handlers: durante un gesto de arrastre —que llama a
  // `setPullDistance` en cada frame— los tres listeners táctiles se
  // quitaban y se volvían a añadir ~60 veces por segundo.
  //
  // Se guardan las partes volátiles en refs y las dependencias quedan
  // vacías: `refresh` es estable de por vida.
  const mutationRef = useRef(mutation)
  // Se actualiza en un efecto, no durante el render: escribir en un ref
  // mientras se renderiza rompe el modo concurrente (react-hooks/refs).
  useEffect(() => {
    mutationRef.current = mutation
  })
  const refresh = useCallback(() => {
    if (mutationRef.current.isPending) return
    mutationRef.current.mutate()
  }, [])

  return {
    status: statusQuery.data ?? null,
    lastOutcome,
    isPending: mutation.isPending,
    refresh,
  }
}

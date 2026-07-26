'use client'

import { useCallback } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import {
  getLocalSavedLocations,
  saveLocalLocation,
  deleteLocalLocation,
  type SavedLocation,
} from '@/lib/localStorageLocations'

export const SAVED_LOCATIONS_KEY = ['saved-locations'] as const

function readInitial(): SavedLocation[] {
  if (typeof window === 'undefined') return []
  return getLocalSavedLocations()
}

/**
 * Centralised reader + mutator for the localStorage-backed list of
 * saved cities. Replaces the three independent `useQuery(['saved-locations'])`
 * call-sites that lived in `home-content.tsx`, `CitiesList` (also
 * inside `home-content.tsx`) and `SavedLocations.tsx`.
 *
 * The mutations work optimistically: the cache is patched to its
 * post-mutation value before `localStorage` is written, so the UI
 * never flashes the stale state.
 */
export function useSavedLocations() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: SAVED_LOCATIONS_KEY,
    queryFn: () => readInitial(),
    initialData: readInitial,
    staleTime: 0,
  })

  const invalidate = useCallback(() => {
    queryClient.setQueryData<SavedLocation[]>(SAVED_LOCATIONS_KEY, readInitial())
  }, [queryClient])

  const add = useMutation({
    mutationFn: async ({ name, lat, lon }: { name: string; lat: number; lon: number }) =>
      saveLocalLocation(name, lat, lon),
    onSuccess: (loc) => {
      queryClient.setQueryData<SavedLocation[]>(SAVED_LOCATIONS_KEY, (prev) =>
        (prev ?? []).concat(loc)
      )
    },
  })

  const remove = useMutation({
    mutationFn: async (id: number) => {
      deleteLocalLocation(id)
    },
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: SAVED_LOCATIONS_KEY })
      const previous = queryClient.getQueryData<SavedLocation[]>(SAVED_LOCATIONS_KEY)
      queryClient.setQueryData<SavedLocation[]>(SAVED_LOCATIONS_KEY, (prev) =>
        (prev ?? []).filter(item => item.id !== id)
      )
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(SAVED_LOCATIONS_KEY, ctx.previous)
      }
    },
    onSettled: () => {
      invalidate()
    },
  })

  return {
    saved: query.data ?? [],
    isLoading: query.isLoading,
    add: add.mutateAsync,
    remove: remove.mutateAsync,
    isAdding: add.isPending,
    isRemoving: remove.isPending,
  } as const
}

/**
 * Imperative variant — useful for scripts / node-side tests that
 * don't have a `QueryClient` available.
 */
export function readSavedLocations(qc: QueryClient): SavedLocation[] {
  return (qc.getQueryData(SAVED_LOCATIONS_KEY) as SavedLocation[] | undefined) ?? []
}

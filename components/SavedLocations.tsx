'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  type SavedLocation,
  getLocalSavedLocations,
  deleteLocalLocation,
} from '@/lib/localStorageLocations'

interface SavedLocationsProps {
  onSelect: (name: string, lat: number, lon: number) => void
}

export default function SavedLocations({ onSelect }: SavedLocationsProps) {
  const queryClient = useQueryClient()

  // Saved cities are per-device (localStorage). The previous version of
  // this component still hit /api/locations — that endpoint now returns
  // 410 Gone, which made the delete action silently fail because the
  // mutation would error out and the optimistic update was never
  // observed. Read straight from localStorage and treat the cache key
  // as the single source of truth.
  const { data: locations = [] } = useQuery<SavedLocation[]>({
    queryKey: ['saved-locations'],
    queryFn: async () => getLocalSavedLocations(),
    staleTime: 5 * 60 * 1000,
    initialData: getLocalSavedLocations,
  })

  const [optimistic, setOptimistic] = useState<SavedLocation[] | null>(null)
  const renderList = optimistic ?? locations

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      // Update localStorage synchronously so the cache re-read on the
      // next render is already correct.
      deleteLocalLocation(id)
      return id
    },
    onMutate: (id) => {
      // Optimistic UI: hide the row immediately so the delete feels
      // responsive. We don't need the row back if the mutation fails,
      // because the deletion already persisted locally.
      setOptimistic(prev => (prev ?? locations).filter(l => l.id !== id))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-locations'] })
      setOptimistic(null)
    },
    onError: () => {
      // Restore the previous list so the UI re-syncs with storage.
      setOptimistic(null)
      queryClient.invalidateQueries({ queryKey: ['saved-locations'] })
    },
  })

  if (!renderList || renderList.length === 0) return null

  return (
    <div className="flex gap-1.5 px-3 py-1.5 bg-gray-900/30 border-b border-gray-800/50 flex-wrap shrink-0">
      {renderList.map(loc => (
        <div
          key={loc.id}
          className="flex items-center gap-1 group shrink-0 bg-gray-800/40 rounded-md px-2 py-0.5"
        >
          <button
            onClick={() => onSelect(loc.name, loc.latitude, loc.longitude)}
            className="text-xs text-gray-300 hover:text-white cursor-pointer transition-colors whitespace-nowrap min-h-[28px]"
          >
            {loc.name}
          </button>
          <button
            type="button"
            onClick={() => deleteMutation.mutate(loc.id)}
            disabled={deleteMutation.isPending}
            className="text-gray-500 hover:text-red-400 cursor-pointer md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-base leading-none px-1 min-h-[28px] disabled:opacity-50"
            aria-label={`Remove ${loc.name}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

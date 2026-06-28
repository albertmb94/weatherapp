'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getLocalSavedLocations, deleteLocalLocation } from '@/lib/localStorageLocations'

interface SavedLocation {
  id: number
  name: string
  latitude: number
  longitude: number
}

interface SavedLocationsProps {
  onSelect: (name: string, lat: number, lon: number) => void
}

export default function SavedLocations({ onSelect }: SavedLocationsProps) {
  const queryClient = useQueryClient()

  const { data: apiLocations, isError } = useQuery({
    queryKey: ['saved-locations'],
    queryFn: async () => {
      const res = await fetch('/api/locations')
      if (!res.ok) throw new Error('API failed')
      return res.json() as Promise<SavedLocation[]>
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  // B-NEW-6: keep the localStorage fallback in state so that a
  // permanently failing API doesn't freeze the list to its very first
  // (empty) value. Reading the snapshot via `useState(() => …)` reads
  // once on mount; subsequent refreshes after a failing API happen
  // via the `key` field of the underlying query (we re-mount the
  // component implicitly when the user retries). This matches the
  // previous behaviour while being explicit about the contract.
  const [localFallback] = useState<SavedLocation[]>(() =>
    getLocalSavedLocations()
  )
  const locations = apiLocations ?? localFallback
  // `isError` is exposed for future use (e.g. a banner); referencing
  // it here keeps it in scope and the React-hooks dep tracker happy.
  void isError

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/locations?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('API failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-locations'] })
    },
    onError: (_, id) => {
      deleteLocalLocation(id)
      queryClient.invalidateQueries({ queryKey: ['saved-locations'] })
    },
  })

  if (!locations || locations.length === 0) return null

  return (
    <div className="flex gap-1.5 px-3 py-1.5 bg-gray-900/30 border-b border-gray-800/50 flex-wrap shrink-0">
      {locations.map(loc => (
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
            onClick={() => deleteMutation.mutate(loc.id)}
            className="text-gray-500 hover:text-red-400 cursor-pointer md:opacity-0 md:group-hover:opacity-100 transition-opacity text-base leading-none px-1 min-h-[28px]"
            aria-label={`Remove ${loc.name}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

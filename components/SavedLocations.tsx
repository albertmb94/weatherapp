'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

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

  const { data: locations } = useQuery({
    queryKey: ['saved-locations'],
    queryFn: async () => {
      const res = await fetch('/api/locations')
      if (!res.ok) return []
      return res.json() as Promise<SavedLocation[]>
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/locations?id=${id}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-locations'] })
    },
  })

  if (!locations || locations.length === 0) return null

  return (
    <div className="flex gap-1.5 px-3 py-1.5 bg-gray-900/30 border-b border-gray-800/50 overflow-x-auto shrink-0">
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

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
    <div className="flex flex-wrap gap-1 px-3 py-1 bg-gray-900/30 border-b border-gray-800/50">
      {locations.map(loc => (
        <div
          key={loc.id}
          className="flex items-center gap-1 group"
        >
          <button
            onClick={() => onSelect(loc.name, loc.latitude, loc.longitude)}
            className="text-[10px] text-gray-500 hover:text-white cursor-pointer transition-colors"
          >
            {loc.name}
          </button>
          <button
            onClick={() => deleteMutation.mutate(loc.id)}
            className="text-gray-700 hover:text-red-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

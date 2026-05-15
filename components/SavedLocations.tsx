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
    <div className="flex flex-wrap gap-2">
      {locations.map(loc => (
        <div
          key={loc.id}
          className="flex items-center gap-1 px-2 py-1 bg-gray-700 rounded text-xs text-gray-300"
        >
          <button
            onClick={() => onSelect(loc.name, loc.latitude, loc.longitude)}
            className="hover:text-white cursor-pointer"
          >
            {loc.name}
          </button>
          <button
            onClick={() => deleteMutation.mutate(loc.id)}
            className="text-red-400 hover:text-red-300 ml-1 cursor-pointer"
          >
            x
          </button>
        </div>
      ))}
    </div>
  )
}

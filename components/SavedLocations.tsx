'use client'

import { useState, useEffect, useRef } from 'react'
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

  // B-NEW-29 (2026-07-30): the "reaction" on save. When a new
  // chip is added (a new id appears in the list), we briefly
  // highlight it with a ring + scale bump so the user can see
  // their action took effect. The previous version only showed
  // a global toast, which disappeared in 2.2s and gave the
  // user no anchor in the UI ("did it actually save?"). The
  // highlight lives 1.6s — long enough to read, short enough
  // not to look broken.
  const [highlightId, setHighlightId] = useState<number | null>(null)
  const prevIdsRef = useRef<Set<number>>(new Set(renderList.map(l => l.id)))
  useEffect(() => {
    const currentIds = new Set(renderList.map(l => l.id))
    let newId: number | null = null
    for (const id of currentIds) {
      if (!prevIdsRef.current.has(id)) {
        newId = id
        break
      }
    }
    prevIdsRef.current = currentIds
    if (newId !== null) {
      setHighlightId(newId)
      const timer = setTimeout(() => setHighlightId(null), 1600)
      return () => clearTimeout(timer)
    }
  }, [renderList])

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
    // B-NEW-29: the container used to be `bg-gray-900/30 border-b
    // border-gray-800/50` — dark-mode generic Tailwind colours
    // that didn't match the rest of the app's design tokens and
    // looked broken on a light theme. Switched to the standard
    // `bg-surface-raised` + `border-border` pair so the strip
    // sits flush with the search header above and the main
    // content below on both light and dark themes. Kept the
    // `flex-wrap` so long saved-locations lists still wrap
    // instead of overflowing horizontally on narrow viewports.
    <div
      data-testid="saved-locations-strip"
      className="flex gap-1.5 px-3 py-1.5 bg-surface-raised border-b border-border flex-wrap shrink-0"
    >
      {renderList.map(loc => {
        const isHighlighted = loc.id === highlightId
        return (
          <div
            key={loc.id}
            data-testid="saved-locations-chip"
            data-highlighted={isHighlighted ? 'true' : 'false'}
            className={`flex items-center gap-1 group shrink-0 rounded-md px-2 py-0.5 transition-all duration-300 ${
              isHighlighted
                // The highlight: emerald ring + faint green
                // fill so it pops without screaming. We also
                // bump the scale briefly via the ring's
                // appearance; the chip itself stays at scale 1
                // because layout shifts would feel janky in a
                // wrap row.
                ? 'bg-emerald-500/20 ring-2 ring-emerald-500/60'
                : 'bg-surface-popover'
            }`}
          >
            <button
              onClick={() => onSelect(loc.name, loc.latitude, loc.longitude)}
              className="text-xs text-text-primary hover:text-accent cursor-pointer transition-colors whitespace-nowrap min-h-[28px]"
            >
              {loc.name}
            </button>
            <button
              type="button"
              onClick={() => deleteMutation.mutate(loc.id)}
              disabled={deleteMutation.isPending}
              className="text-text-tertiary hover:text-red-400 cursor-pointer md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-base leading-none px-1 min-h-[28px] disabled:opacity-50"
              aria-label={`Remove ${loc.name}`}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

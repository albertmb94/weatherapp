'use client'

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import StationCard from './StationCard'
import StationMap from './StationMap'
import { REGIONS } from '@/lib/meteoclimatic-types'
import type { MeteoclimaticResponse } from '@/lib/meteoclimatic-types'

export default function StationDashboard() {
  const [region, setRegion] = useState('ESCAT08')

  const { data, isLoading, error, refetch } = useQuery<MeteoclimaticResponse>({
    queryKey: ['meteoclimatic', region],
    queryFn: async () => {
      const res = await fetch(`/api/meteoclimatic?station=${region}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  })

  const handleRegionChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setRegion(e.target.value)
  }, [])

  const stations = data?.stations ?? []

  return (
    <div className="flex flex-col gap-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-500 shrink-0">Región:</label>
        <select
          value={region}
          onChange={handleRegionChange}
          className="bg-gray-900 border border-gray-800 text-gray-300 text-xs rounded-lg px-3 py-1.5
                     focus:outline-none focus:border-gray-600 cursor-pointer"
        >
          {REGIONS.map(r => (
            <option key={r.code} value={r.code}>{r.label}</option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors cursor-pointer disabled:opacity-50"
        >
          ↻
        </button>
        <div className="text-[11px] text-gray-600">
          {stations.length > 0 && `${stations.length} estaciones`}
        </div>
      </div>

      <div className="w-full aspect-[2/1] min-h-[200px] max-h-[400px] rounded-lg overflow-hidden">
        <StationMap stations={stations} />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-gray-600 border-t-white rounded-full" />
          <span className="ml-3 text-sm text-gray-500">Cargando estaciones...</span>
        </div>
      )}

      {error && (
        <div className="text-center py-8">
          <p className="text-sm text-red-400">Error al cargar datos de estaciones</p>
          <button
            onClick={() => refetch()}
            className="mt-2 text-xs text-gray-500 hover:text-gray-300 underline cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}

      {!isLoading && !error && stations.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500">No hay estaciones disponibles para esta región</p>
        </div>
      )}

      {stations.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {stations.map(s => (
            <StationCard key={s.code} station={s} />
          ))}
        </div>
      )}
    </div>
  )
}

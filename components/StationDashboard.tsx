'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import StationCard from './StationCard'
import StationMap from './StationMap'
import type { MeteoclimaticObservation } from '@/lib/meteoclimatic-types'

interface AemetRaw {
  idema: string; ubi: string; lat: number; lon: number; fint: string
  ta: number | null; tamax: number | null; tamin: number | null
  hr: number | null; vv: number | null; vmax: number | null; dv: number | null; prec: number | null
}

const WIND_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
function bearingToDir(b: number): string { return WIND_DIRS[Math.round(b / 22.5) % 16] ?? '' }

function n(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const p = parseFloat(v); return isNaN(p) ? null : p }
  return null
}

function mapAemet(s: AemetRaw): MeteoclimaticObservation {
  const dv = n(s.dv)
  return {
    code: s.idema,
    name: s.ubi || s.idema,
    lat: n(s.lat) ?? 0, lon: n(s.lon) ?? 0,
    updatedAt: s.fint || '',
    temperature: { current: n(s.ta), max: n(s.tamax), min: n(s.tamin) },
    condition: '',
    humidity: { current: n(s.hr), max: null, min: null },
    pressure: { current: null, max: null, min: null },
    wind: {
      speed: n(s.vv), gust: n(s.vmax),
      bearing: dv,
      direction: dv != null ? bearingToDir(dv) : '',
    },
    precipitation: n(s.prec),
  }
}

export default function StationDashboard() {
  const [search, setSearch] = useState('')

  const { data, isLoading, error, refetch } = useQuery<MeteoclimaticObservation[]>({
    queryKey: ['aemet-stations'],
    queryFn: async () => {
      const res = await fetch('/api/aemet')
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.detail || body.error || `HTTP ${res.status}`)
      const raw: AemetRaw[] = body.stations
      const seen = new Map<string, MeteoclimaticObservation>()
      for (const s of raw) {
        if (!seen.has(s.idema)) seen.set(s.idema, mapAemet(s))
      }
      return [...seen.values()]
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
    retry: 1,
    retryDelay: 5000,
  })

  const stations = data ?? []

  const filtered = useMemo(() => {
    if (!search) return stations
    const q = search.toLowerCase()
    return stations.filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
  }, [stations, search])

  return (
    <div className="flex flex-col gap-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Buscar estación..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-900 border border-gray-800 text-gray-300 text-xs rounded-lg px-3 py-1.5 flex-1 max-w-xs
                     focus:outline-none focus:border-gray-600 placeholder-gray-600"
        />
        <div className="flex-1" />
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors cursor-pointer disabled:opacity-50"
        >
          ↻
        </button>
        <div className="text-[11px] text-gray-600">
          {filtered.length > 0 && `${filtered.length} estaciones`}
        </div>
      </div>

      <div className="w-full aspect-[2/1] min-h-[200px] max-h-[400px] rounded-lg overflow-hidden">
        <StationMap stations={filtered} />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-gray-600 border-t-white rounded-full" />
          <span className="ml-3 text-sm text-gray-500">Cargando estaciones de AEMET...</span>
        </div>
      )}

      {error && (
        <div className="text-center py-8">
          <p className="text-sm text-red-400">Error al cargar datos de estaciones</p>
          <p className="text-xs text-gray-500 mt-1">{(error as Error).message}</p>
          <button
            onClick={() => refetch()}
            className="mt-3 text-xs text-gray-500 hover:text-gray-300 underline cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && stations.length > 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500">No se encontraron estaciones para &quot;{search}&quot;</p>
        </div>
      )}

      {!isLoading && !error && stations.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500">No hay estaciones disponibles</p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.slice(0, 40).map(s => (
            <StationCard key={s.code} station={s} />
          ))}
        </div>
      )}
    </div>
  )
}

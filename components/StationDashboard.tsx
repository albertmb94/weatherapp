'use client'

import { useState, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import StationCard from './StationCard'
import StationMap from './StationMap'
import type { MeteoclimaticObservation } from '@/lib/meteoclimatic-types'

interface AemetStationRaw {
  idema: string
  nombre: string
  lat?: number
  lon?: number
  latitud?: number
  longitud?: number
  fint: string
  tmed: string | number | null
  tmax: string | number | null
  tmin: string | number | null
  hum: string | number | null
  hum_max: string | number | null
  hum_min: string | number | null
  pres: string | number | null
  pres_max: string | number | null
  pres_min: string | number | null
  velmedia: string | number | null
  racha: string | number | null
  dir: string | number | null
  prec: string | number | null
}

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '' || v === 'Ip' || v === '---') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}

const WIND_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
function bearingToDir(b: number): string { return WIND_DIRS[Math.round(b / 22.5) % 16] ?? '' }

function mapAemetToStation(s: AemetStationRaw): MeteoclimaticObservation {
  const lat = toNum(s.lat) ?? toNum(s.latitud) ?? 0
  const lon = toNum(s.lon) ?? toNum(s.longitud) ?? 0
  const dir = toNum(s.dir)
  return {
    code: s.idema,
    name: s.nombre || s.idema,
    lat, lon,
    updatedAt: s.fint || '',
    temperature: { current: toNum(s.tmed), max: toNum(s.tmax), min: toNum(s.tmin) },
    condition: '',
    humidity: { current: toNum(s.hum), max: toNum(s.hum_max), min: toNum(s.hum_min) },
    pressure: { current: toNum(s.pres), max: toNum(s.pres_max), min: toNum(s.pres_min) },
    wind: {
      speed: toNum(s.velmedia),
      gust: toNum(s.racha),
      bearing: dir,
      direction: dir !== null ? bearingToDir(dir) : '',
    },
    precipitation: toNum(s.prec),
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
      return (body.stations as AemetStationRaw[]).map(mapAemetToStation)
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

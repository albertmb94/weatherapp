'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import StationCard from './StationCard'
import StationMap from './StationMap'
import { REGIONS } from '@/lib/meteoclimatic-types'
import type { MeteoclimaticObservation } from '@/lib/meteoclimatic-types'

interface AemetRaw {
  idema: string; ubi: string; lat: number; lon: number; fint: string
  ta: number | null; tamax: number | null; tamin: number | null
  hr: number | null; vv: number | null; vmax: number | null; dv: number | null; prec: number | null
}

const WIND_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
function bearingToDir(b: number): string { return WIND_DIRS[Math.round(b / 22.5) % 16] ?? '' }

function n(v: unknown): number | null {
  if (v == null) return null
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
  const [region, setRegion] = useState(REGIONS[0].code)
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

  const regionBounds = REGIONS.find(r => r.code === region) ?? REGIONS[0]

  const filtered = useMemo(() => {
    let result = stations.filter(s =>
      s.lat >= regionBounds.latMin && s.lat <= regionBounds.latMax &&
      s.lon >= regionBounds.lonMin && s.lon <= regionBounds.lonMax
    )
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
    }
    return result
  }, [stations, region, search, regionBounds])

  return (
    <div className="flex flex-col gap-3 animate-fadeIn">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={region}
          onChange={e => { setRegion(e.target.value); setSearch('') }}
          className="bg-gray-900 border border-gray-800 text-gray-300 text-xs rounded-lg px-2 py-1.5
                     focus:outline-none focus:border-gray-600 cursor-pointer"
        >
          {REGIONS.map(r => (
            <option key={r.code} value={r.code}>{r.label}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Buscar..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-900 border border-gray-800 text-gray-300 text-xs rounded-lg px-2 py-1.5 w-40
                     focus:outline-none focus:border-gray-600 placeholder-gray-600"
        />
        <div className="flex-1" />
        <span className="text-[10px] text-gray-600">{filtered.length} estaciones</span>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors cursor-pointer disabled:opacity-50"
        >
          ↻
        </button>
      </div>

      <div className="w-full aspect-[2/1] min-h-[180px] max-h-[320px] rounded-lg overflow-hidden">
        <StationMap stations={filtered} />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin w-5 h-5 border-2 border-gray-600 border-t-white rounded-full" />
          <span className="ml-2 text-xs text-gray-500">Cargando...</span>
        </div>
      )}

      {error && (
        <div className="text-center py-6">
          <p className="text-sm text-red-400">Error al cargar estaciones</p>
          <p className="text-xs text-gray-500 mt-1">{(error as Error).message}</p>
          <button onClick={() => refetch()} className="mt-2 text-xs text-gray-500 hover:text-gray-300 underline cursor-pointer">
            Reintentar
          </button>
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && stations.length > 0 && (
        <p className="text-xs text-gray-500 text-center py-4">Sin resultados para &quot;{search}&quot;</p>
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
          {filtered.map(s => (
            <StationCard key={s.code} station={s} />
          ))}
        </div>
      )}
    </div>
  )
}

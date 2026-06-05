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
    wind: { speed: n(s.vv), gust: n(s.vmax), bearing: dv, direction: dv != null ? bearingToDir(dv) : '' },
    precipitation: n(s.prec),
  }
}

const METEOCLIMATIC_MAP: Record<string, string> = {
  BCN: 'ESCAT08', LLE: 'ESCAT25', GIR: 'ESCAT17', TAR: 'ESCAT43',
  CAT: 'ESCAT', MAD: 'ESMAD', VLC: 'ESPVA', BCN_C: 'ESCAT08',
}

const STATION_RETRY_COUNT = 5
const STATION_RETRY_DELAY_MS = 1000

export default function StationDashboard() {
  const [region, setRegion] = useState(REGIONS[0].code)
  const [search, setSearch] = useState('')
  const [includeMeteo, setIncludeMeteo] = useState(false)

  const aemetQ = useQuery<MeteoclimaticObservation[]>({
    queryKey: ['aemet-stations'],
    queryFn: async () => {
      const res = await fetch('/api/aemet')
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.detail || body.error || `HTTP ${res.status}`)
      const seen = new Map<string, MeteoclimaticObservation>()
      for (const s of body.stations as AemetRaw[]) {
        if (!seen.has(s.idema)) seen.set(s.idema, mapAemet(s))
      }
      return [...seen.values()]
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
    retry: STATION_RETRY_COUNT,
    retryDelay: STATION_RETRY_DELAY_MS,
  })

  const meteoCode = METEOCLIMATIC_MAP[region] ?? 'ESCAT08'

  const meteoQ = useQuery<MeteoclimaticObservation[]>({
    queryKey: ['meteoclimatic', meteoCode],
    queryFn: async () => {
      const res = await fetch(`/api/meteoclimatic?station=${meteoCode}`)
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.detail || body.error || `HTTP ${res.status}`)
      return body.stations
    },
    enabled: includeMeteo,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
    retry: STATION_RETRY_COUNT,
    retryDelay: STATION_RETRY_DELAY_MS,
  })

  const allStations = useMemo(() => {
    const aemet = aemetQ.data ?? []
    const meteo = includeMeteo ? (meteoQ.data ?? []) : []
    const seen = new Map<string, MeteoclimaticObservation>()
    for (const s of aemet) seen.set('A-' + s.code, s)
    for (const s of meteo) {
      const key = 'M-' + s.code
      if (!seen.has(key) && !Array.from(seen.values()).some(v => Math.abs(v.lat - s.lat) < 0.01 && Math.abs(v.lon - s.lon) < 0.01)) {
        seen.set(key, s)
      }
    }
    return [...seen.values()]
  }, [aemetQ.data, meteoQ.data, includeMeteo])

  const regionBounds = REGIONS.find(r => r.code === region) ?? REGIONS[0]

  const filtered = useMemo(() => {
    let result = allStations.filter(s =>
      s.lat >= regionBounds.latMin && s.lat <= regionBounds.latMax &&
      s.lon >= regionBounds.lonMin && s.lon <= regionBounds.lonMax
    )
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
    }
    return result
  }, [allStations, region, search, regionBounds])

  const isLoading = aemetQ.isLoading || (includeMeteo && meteoQ.isLoading)
  const isFetching = aemetQ.isFetching || (includeMeteo && meteoQ.isFetching)
  const error = aemetQ.error || (includeMeteo && meteoQ.error)
  // While react-query is retrying, isError may already be true from a previous
  // attempt. Hide the error block until the in-flight retry settles so the
  // user only sees the loading spinner, not a stale error message.
  const showLoading = isLoading || isFetching
  const showError = !!error && !isFetching

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
          className="bg-gray-900 border border-gray-800 text-gray-300 text-xs rounded-lg px-2 py-1.5 w-36
                     focus:outline-none focus:border-gray-600 placeholder-gray-600"
        />
        <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeMeteo}
            onChange={e => setIncludeMeteo(e.target.checked)}
            className="rounded border-gray-700 bg-gray-900 text-blue-500 focus:ring-gray-600 w-3 h-3"
          />
          Meteoclimatic
        </label>
        <div className="flex-1" />
        <span className="text-[10px] text-gray-600">{filtered.length}</span>
        <button
          onClick={() => { aemetQ.refetch(); if (includeMeteo) meteoQ.refetch() }}
          disabled={isLoading}
          className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors cursor-pointer disabled:opacity-50"
        >
          ↻
        </button>
      </div>

      <div className="w-full aspect-[2/1] min-h-[180px] max-h-[320px] rounded-lg overflow-hidden">
        <StationMap stations={filtered} />
      </div>

      {showLoading && (
        <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
          <div className="animate-spin w-5 h-5 border-2 border-gray-600 border-t-white rounded-full" />
          <span className="ml-2 text-xs text-gray-500">Cargando...</span>
        </div>
      )}

      {!showLoading && filtered.length === 0 && (
        <p className="text-xs text-gray-500 text-center py-4">
          {search ? `Sin resultados para "${search}"` : 'Sin estaciones en esta región'}
        </p>
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
          {filtered.map(s => (
            <StationCard key={s.code + s.name} station={s} />
          ))}
        </div>
      )}

      {showError && (
        <div className="text-center py-6 mt-2 border-t border-gray-800/60" role="alert">
          <p className="text-sm text-red-400">Error al cargar estaciones</p>
          <p className="text-xs text-gray-500 mt-1">{(error as Error).message}</p>
          <button onClick={() => aemetQ.refetch()} className="mt-2 text-xs text-gray-500 hover:text-gray-300 underline cursor-pointer">
            Reintentar
          </button>
        </div>
      )}
    </div>
  )
}

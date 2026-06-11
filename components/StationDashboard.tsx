'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import StationCard from './StationCard'
import StationMap from './StationMap'
import { REGIONS } from '@/lib/meteoclimatic-types'
import type { MeteoclimaticObservation } from '@/lib/meteoclimatic-types'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import { withDistance } from '@/lib/geoDistance'

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
    // M1: AEMET provides wind speed in m/s; convert to km/h to match the
    // convention of Meteoclimatic and the rest of the UI.
    wind: { speed: n(s.vv) != null ? n(s.vv)! * 3.6 : null, gust: n(s.vmax) != null ? n(s.vmax)! * 3.6 : null, bearing: dv, direction: dv != null ? bearingToDir(dv) : '' },
    precipitation: n(s.prec),
  }
}

const METEOCLIMATIC_MAP: Record<string, string> = {
  BCN: 'ESCAT08', LLE: 'ESCAT25', GIR: 'ESCAT17', TAR: 'ESCAT43',
  CAT: 'ESCAT', MAD: 'ESMAD', VLC: 'ESPVA', BCN_C: 'ESCAT08',
}

const STATION_RETRY_COUNT = 5
const STATION_RETRY_DELAY_MS = 1000

export interface StationDashboardProps {
  /** Current city centre (from home-content). When provided, Meteoclimatic
   *  is fetched by coordinates and filtered by radius. */
  position?: [number, number] | null
  /** Display name of the current city (for the "Near X" label). */
  placeName?: string
}

export default function StationDashboard({ position = null, placeName }: StationDashboardProps = {}) {
  const { locale } = useLocale()
  const [region, setRegion] = useState(REGIONS[0].code)
  const [radius, setRadius] = useState(30)
  const [search, setSearch] = useState('')
  const [includeMeteo, setIncludeMeteo] = useState(true)

  const aemetQ = useQuery<MeteoclimaticObservation[]>({
    queryKey: ['aemet-stations'],
    queryFn: async () => {
      const res = await fetch('/api/aemet')
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.detail || body.error || `HTTP ${res.status}`)
      const seen = new Map<string, MeteoclimaticObservation>()
      for (const s of body.stations as AemetRaw[]) {
        const mapped = mapAemet(s)
        const existing = seen.get(s.idema)
        if (!existing || (mapped.updatedAt > existing.updatedAt)) {
          seen.set(s.idema, mapped)
        }
      }
      return [...seen.values()]
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
    retry: STATION_RETRY_COUNT,
    retryDelay: STATION_RETRY_DELAY_MS,
  })

  // Meteoclimatic: two modes. When a position is provided we ask the
  // server to fetch by coordinates and filter by radius (S5). Otherwise
  // we fall back to the per-region feed.
  const meteoCoordKey = position ? [Math.round(position[0] * 10) / 10, Math.round(position[1] * 10) / 10, radius] : null
  const meteoRegionCode = METEOCLIMATIC_MAP[region] ?? 'ESCAT08'

  const meteoQ = useQuery<MeteoclimaticObservation[]>({
    queryKey: position && meteoCoordKey
      ? ['meteoclimatic-coord', meteoCoordKey[0], meteoCoordKey[1], meteoCoordKey[2]]
      : ['meteoclimatic', meteoRegionCode],
    queryFn: async () => {
      const url = position && meteoCoordKey
        ? `/api/meteoclimatic?lat=${meteoCoordKey[0]}&lon=${meteoCoordKey[1]}&radius=${meteoCoordKey[2]}&limit=50`
        : `/api/meteoclimatic?station=${meteoRegionCode}`
      const res = await fetch(url)
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.detail || body.error || `HTTP ${res.status}`)
      return body.stations
    },
    enabled: includeMeteo,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
    // Meteoclimatic frequently blocks server-side requests with a 4xx
    // (403/404). Those won't recover on retry, so fail fast instead of
    // hammering for ~5s; only retry transient (5xx/network) errors.
    retry: (failureCount, err) => {
      const msg = err instanceof Error ? err.message : ''
      if (/\b(400|403|404)\b/.test(msg)) return false
      return failureCount < 2
    },
    retryDelay: STATION_RETRY_DELAY_MS,
  })

  // Meteocat XEMA: official Catalan network. Location-independent (the route
  // returns the whole network, cached server-side); we filter by radius
  // client-side below. No-ops gracefully when the server has no API key.
  const meteocatQ = useQuery<MeteoclimaticObservation[]>({
    queryKey: ['meteocat-stations'],
    queryFn: async () => {
      const res = await fetch('/api/meteocat')
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.detail || body.error || `HTTP ${res.status}`)
      return body.stations as MeteoclimaticObservation[]
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
    retry: (failureCount, err) => {
      const msg = err instanceof Error ? err.message : ''
      if (/\b(400|401|403|404)\b/.test(msg)) return false
      return failureCount < 2
    },
    retryDelay: STATION_RETRY_DELAY_MS,
  })

  const allStations = useMemo(() => {
    const aemet = aemetQ.data ?? []
    const meteocat = meteocatQ.data ?? []
    const meteo = includeMeteo ? (meteoQ.data ?? []) : []
    const seen = new Map<string, MeteoclimaticObservation>()
    const spatialIndex = new Map<string, MeteoclimaticObservation>()
    for (const s of aemet) {
      const cell = `${Math.round(s.lat * 100)}:${Math.round(s.lon * 100)}`
      if (!spatialIndex.has(cell)) spatialIndex.set(cell, s)
    }
    for (const s of aemet) seen.set('A-' + s.code, s)
    // Meteocat (official) before Meteoclimatic (amateur): when two stations
    // share a cell, the official reading wins.
    for (const s of meteocat) {
      const key = 'C-' + s.code
      if (seen.has(key)) continue
      const cell = `${Math.round(s.lat * 100)}:${Math.round(s.lon * 100)}`
      if (!spatialIndex.has(cell)) {
        seen.set(key, s)
        spatialIndex.set(cell, s)
      }
    }
    for (const s of meteo) {
      const key = 'M-' + s.code
      if (seen.has(key)) continue
      const cell = `${Math.round(s.lat * 100)}:${Math.round(s.lon * 100)}`
      if (!spatialIndex.has(cell)) {
        seen.set(key, s)
        spatialIndex.set(cell, s)
      }
    }
    return [...seen.values()]
  }, [aemetQ.data, meteocatQ.data, meteoQ.data, includeMeteo])

  // Filter: when a position is provided we filter AEMET by the
  // user-selected radius; otherwise we keep the legacy region-bbox
  // filter. Meteoclimatic is already server-filtered when a position
  // is provided.
  const regionBounds = REGIONS.find(r => r.code === region) ?? REGIONS[0]

  const filtered = useMemo(() => {
    let result: (MeteoclimaticObservation & { distanceKm?: number })[]
    if (position) {
      result = withDistance(allStations, position).filter(s => (s.distanceKm ?? Infinity) <= radius)
    } else {
      result = allStations.filter(s =>
        s.lat >= regionBounds.latMin && s.lat <= regionBounds.latMax &&
        s.lon >= regionBounds.lonMin && s.lon <= regionBounds.lonMax
      )
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
    }
    // S5.4: sort by distance when available.
    if (position) {
      result = [...result].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
    }
    return result
  }, [allStations, position, radius, regionBounds, search])

  // AEMET is the primary, reliable source: it alone gates the loading state
  // and the blocking error. Meteoclimatic is supplementary (opt-in checkbox),
  // so its failure must never blank the dashboard or hide AEMET stations — it
  // only surfaces a subtle notice. This also prevents Meteoclimatic's retries
  // from keeping the whole tab spinning while AEMET data is already available.
  const showLoading = aemetQ.isLoading
  const error = aemetQ.error
  const showError = !!error && !aemetQ.isFetching
  const meteoUnavailable = includeMeteo && !!meteoQ.error && !meteoQ.isFetching

  return (
    <div className="flex flex-col gap-3 animate-fadeIn">
      <div className="flex items-center gap-2 flex-wrap">
        {position ? (
          <span className="text-xs text-gray-300 bg-gray-900/50 border border-gray-800 rounded-lg px-2 py-1.5">
            {STRINGS[locale].nearLabel}{' '}
            <span className="font-semibold text-white">{placeName ?? `${position[0].toFixed(2)}, ${position[1].toFixed(2)}`}</span>
            <span className="text-gray-500"> · {radius} km</span>
          </span>
        ) : (
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
        )}
        <input
          type="text"
          placeholder={STRINGS[locale].searchPlaceholder}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-900 border border-gray-800 text-gray-300 text-xs rounded-lg px-2 py-1.5 w-36
                     focus:outline-none focus:border-gray-600 placeholder-gray-600"
        />
        {position && (
          <select
            value={radius}
            onChange={e => setRadius(Number(e.target.value))}
            className="bg-gray-900 border border-gray-800 text-gray-300 text-xs rounded-lg px-2 py-1.5
                       focus:outline-none focus:border-gray-600 cursor-pointer"
            aria-label={STRINGS[locale].radiusLabel}
          >
            {[10, 30, 60, 100].map(r => (
              <option key={r} value={r}>{r} km</option>
            ))}
          </select>
        )}
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
          onClick={() => { aemetQ.refetch(); meteocatQ.refetch(); if (includeMeteo) meteoQ.refetch() }}
          disabled={aemetQ.isFetching}
          className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors cursor-pointer disabled:opacity-50"
        >
          ↻
        </button>
      </div>

      {meteoUnavailable && (
        <p className="text-[10px] text-amber-500/80 -mt-1" role="status">
          {STRINGS[locale].meteoclimaticUnavailable}
        </p>
      )}

      <div className="w-full aspect-[2/1] min-h-[180px] max-h-[320px] rounded-lg overflow-hidden">
        <StationMap stations={filtered} />
      </div>

      {showLoading && (
        <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
          <div className="animate-spin w-5 h-5 border-2 border-gray-600 border-t-white rounded-full" />
          <span className="ml-2 text-xs text-gray-500">{STRINGS[locale].loadingStations}</span>
        </div>
      )}

      {!showLoading && filtered.length === 0 && (
        <p className="text-xs text-gray-500 text-center py-4">
          {search
            ? `${STRINGS[locale].noResults} "${search}"`
            : position
              ? `${STRINGS[locale].noStationsRadius.replace('{km}', String(radius))}`
              : STRINGS[locale].noStationsRegion}
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
          <p className="text-sm text-red-400">{STRINGS[locale].stationError}</p>
          <p className="text-xs text-gray-500 mt-1">{error instanceof Error ? error.message : String(error)}</p>
          <button
            onClick={() => { aemetQ.refetch(); meteocatQ.refetch(); if (includeMeteo) meteoQ.refetch() }}
            className="mt-2 text-xs text-gray-500 hover:text-gray-300 underline cursor-pointer"
          >
            {STRINGS[locale].retry}
          </button>
        </div>
      )}
    </div>
  )
}

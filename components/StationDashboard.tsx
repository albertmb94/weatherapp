'use client'

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
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

// F1: mobile users prefer the tightest possible radius (their
// thumb is on the screen, scrolling through 20 stations in 60
// km is friction they don't want), while desktop users browse a
// larger radius with a mouse. The breakpoint is the same one
// that gates the "real-desktop" Tailwind variant in
// `app/globals.css` (>=1024 px).
const MOBILE_DEFAULT_RADIUS_KM = 5
const DESKTOP_DEFAULT_RADIUS_KM = 10
const MOBILE_RADIUS_OPTIONS = [5, 10, 30, 60] as const
const DESKTOP_RADIUS_OPTIONS = [10, 30, 60, 100] as const
const REAL_DESKTOP_MQ = '(min-width: 1024px)'

/**
 * SSR-safe hook that returns `true` when the viewport is wide
 * enough to be considered "real desktop" (>=1024 px). Starts
 * `false` to match the SSR render and the first client render,
 * then updates inside an effect — same pattern as the rest of
 * the app to keep React 19 strict-mode clean.
 */
function useIsRealDesktop(): boolean {
  const [isRealDesktop, setIsRealDesktop] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(REAL_DESKTOP_MQ)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsRealDesktop(mq.matches)
    const onChange = () => setIsRealDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isRealDesktop
}

export interface StationDashboardProps {
  /** Current city centre (from home-content). When provided, Meteoclimatic
   *  is fetched by coordinates and filtered by radius. */
  position?: [number, number] | null
  /** Display name of the current city (for the "Near X" label). */
  placeName?: string
}

export default function StationDashboard({ position = null, placeName }: StationDashboardProps = {}) {
  const { locale } = useLocale()
  const isRealDesktop = useIsRealDesktop()
  const defaultRadius = isRealDesktop ? DESKTOP_DEFAULT_RADIUS_KM : MOBILE_DEFAULT_RADIUS_KM
  const radiusOptions = isRealDesktop ? DESKTOP_RADIUS_OPTIONS : MOBILE_RADIUS_OPTIONS
  const [region, setRegion] = useState(REGIONS[0].code)
  const [radius, setRadius] = useState(defaultRadius)
  // F1: if the user resizes from mobile to desktop (or vice
  // versa) and never touched the radius selector, snap the
  // default to the new breakpoint. The user who DID touch the
  // selector keeps their pick — we detect "untouched" via the
  // `userAdjustedRadius` flag.
  const [userAdjustedRadius, setUserAdjustedRadius] = useState(false)
  const [search, setSearch] = useState('')
  const [includeMeteo, setIncludeMeteo] = useState(true)
  // F1 (desktop): the keyboard-nav cursor. -1 means "no station
  // is focused"; otherwise it points into the `filtered` array.
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const stationGridRef = useRef<HTMLDivElement | null>(null)

  // Sprint 10 / B-10-5 (E9): debounce the radius so dragging the
  // slider doesn't fire 3 upstream calls per second. We expose the
  // immediate value to the UI (so the chip updates instantly) and the
  // debounced value to the query keys (so the network only fires when
  // the user stops moving).
  const [debouncedRadius, setDebouncedRadius] = useState(radius)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedRadius(radius), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [radius])

  // F1: when the viewport breakpoint changes, snap the radius
  // to the new default — but only if the user never picked one
  // explicitly. Same effect could be merged with the one above
  // but we keep it separate for clarity. The cascading-render
  // warning is intentional: there's no other way to react to a
  // viewport change synchronously.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!userAdjustedRadius) setRadius(defaultRadius)
  }, [defaultRadius, userAdjustedRadius])

  // Build a coarse position key so the query refetches when the user moves
  // significantly (1 km grid) without thrashing on tiny movements.
  const posKey = position
    ? `${Math.round(position[0] * 100) / 100},${Math.round(position[1] * 100) / 100}`
    : null

  const aemetQ = useQuery<MeteoclimaticObservation[]>({
    queryKey: posKey ? ['aemet-stations', posKey, debouncedRadius] : ['aemet-stations'],
    queryFn: async () => {
      const url = posKey
        ? `/api/aemet?lat=${position![0]}&lon=${position![1]}&radius=${debouncedRadius}`
        : '/api/aemet'
      const res = await fetch(url)
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
  const meteoCoordKey = position ? [Math.round(position[0] * 10) / 10, Math.round(position[1] * 10) / 10, debouncedRadius] : null
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

  // Meteocat XEMA: official Catalan network. Server-side filtered when a
  // position is provided; otherwise returns the full network (cached).
  const meteocatQ = useQuery<MeteoclimaticObservation[]>({
    queryKey: posKey ? ['meteocat-stations', posKey, debouncedRadius] : ['meteocat-stations'],
    queryFn: async () => {
      const url = posKey
        ? `/api/meteocat?lat=${position![0]}&lon=${position![1]}&radius=${debouncedRadius}`
        : '/api/meteocat'
      const res = await fetch(url)
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

  // Merge and deduplicate across all three sources. Since AEMET and Meteocat
  // are now server-filtered by radius when a position is provided, this
  // operates on ~20-50 stations instead of ~1100.
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

  // Filter: server-side geo filtering is now applied for AEMET and Meteocat
  // when a position is provided. This client-side filter serves as a secondary
  // check and handles the region-bbox fallback when no position is set.
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

  // F1 (desktop only): keyboard navigation across the station
  // grid. Arrow keys move the cursor; Home/End jump to the
  // edges; Enter "opens" the focused card (the card itself is
  // non-clickable on desktop because the user is just browsing
  // the readings, but we still dispatch a click so any future
  // detail panel will react). The cursor is clamped to the
  // current `filtered` length so a re-query that drops a row
  // doesn't leave the focus pointing at a deleted cell.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (focusedIdx >= filtered.length) setFocusedIdx(filtered.length - 1)
  }, [filtered.length, focusedIdx])
  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (filtered.length === 0) return
      const target = e.target as HTMLElement
      // Ignore keys when the user is typing in the search box.
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      let next = focusedIdx
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = focusedIdx < 0 ? 0 : Math.min(filtered.length - 1, focusedIdx + 1)
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          next = focusedIdx < 0 ? 0 : Math.max(0, focusedIdx - 1)
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = filtered.length - 1
          break
        case 'Enter':
        case ' ':
          if (focusedIdx >= 0 && focusedIdx < filtered.length) {
            // The card itself is informational; we just flash a
            // selection ring (already implemented) and prevent
            // the page from scrolling on space.
            e.preventDefault()
          }
          return
        default:
          return
      }
      e.preventDefault()
      setFocusedIdx(next)
    },
    [filtered.length, focusedIdx],
  )

  // AEMET is the primary, reliable source: it alone gates the loading state
  // and the blocking error. Meteoclimatic and Meteocat are supplementary
  // (opt-in or always-on-but-degrades), so their failures must never blank
  // the dashboard or hide AEMET stations. This also prevents their retries
  // from keeping the whole tab spinning while AEMET data is already available.
  const showLoading = aemetQ.isLoading
  const error = aemetQ.error
  const showError = !!error && !aemetQ.isFetching

  return (
    <div className="flex flex-col gap-3 animate-fadeIn">
      {/* B-NEW-8: split the toolbar into two rows on mobile portrait so the
         search input is not crushed by the radius selector and the
         "Meteoclimatic" toggle. The desktop layout (>=md) collapses back
         to a single row. */}
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
            onChange={e => {
              setRadius(Number(e.target.value))
              setUserAdjustedRadius(true)
            }}
            className="bg-gray-900 border border-gray-800 text-gray-300 text-xs rounded-lg px-2 py-1.5
                       focus:outline-none focus:border-gray-600 cursor-pointer"
            aria-label={STRINGS[locale].radiusLabel}
          >
            {radiusOptions.map(r => (
              <option key={r} value={r}>{r} km</option>
            ))}
          </select>
        )}
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
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeMeteo}
            onChange={e => setIncludeMeteo(e.target.checked)}
            className="rounded border-gray-700 bg-gray-900 text-blue-500 focus:ring-gray-600 w-3 h-3"
          />
          Meteoclimatic
        </label>
      </div>

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
        // M-UI-1: empty state is now illustrated with an SVG icon and a
        // primary "widen radius" CTA when relevant. Plain text only
        // when search has no matches (no actionable next step).
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          {search ? (
            <p className="text-xs text-gray-500">
              {STRINGS[locale].noResults} &quot;{search}&quot;
            </p>
          ) : position ? (
            <>
              <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <p className="text-xs text-gray-500 max-w-xs">
                {STRINGS[locale].noStationsRadius.replace('{km}', String(radius))}
              </p>
              {radius < 100 && (
                <button
                  type="button"
                  onClick={() => setRadius(r => Math.min(100, r === 10 ? 30 : r === 30 ? 60 : 100))}
                  className="mt-1 px-3 py-1.5 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 cursor-pointer"
                >
                  {STRINGS[locale].expandRadius.replace('{km}', String(radius === 10 ? 30 : radius === 30 ? 60 : 100))}
                </button>
              )}
            </>
          ) : (
            <p className="text-xs text-gray-500">{STRINGS[locale].noStationsRegion}</p>
          )}
        </div>
      )}

      {filtered.length > 0 && (
        <div
          ref={stationGridRef}
          // F1: keyboard navigation is desktop-only. We give the
          // grid a tabindex so screen readers treat it as a single
          // composite widget, but the key handler is a no-op on
          // mobile (pointer: coarse) so it doesn't interfere with
          // the touch-driven UI. The active descendant is
          // announced via `aria-activedescendant`.
          tabIndex={isRealDesktop ? 0 : -1}
          role={isRealDesktop ? 'grid' : undefined}
          aria-activedescendant={isRealDesktop && focusedIdx >= 0 ? `station-card-${filtered[focusedIdx]?.code}` : undefined}
          onKeyDown={isRealDesktop ? handleGridKeyDown : undefined}
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-lg"
        >
          {filtered.map((s, idx) => (
            <div
              key={s.code + s.name}
              id={`station-card-${s.code}`}
              role={isRealDesktop ? 'gridcell' : undefined}
              aria-selected={isRealDesktop ? idx === focusedIdx : undefined}
              onClick={isRealDesktop ? () => setFocusedIdx(idx) : undefined}
              onFocus={isRealDesktop ? () => setFocusedIdx(idx) : undefined}
              className={isRealDesktop && idx === focusedIdx ? 'ring-2 ring-accent rounded-lg' : ''}
            >
              <StationCard station={s} />
            </div>
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

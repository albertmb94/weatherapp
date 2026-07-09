'use client'

import { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'

import CitySearch from '@/components/CitySearch'
import MetricPills from '@/components/MetricPills'
import ModelSelector from '@/components/ModelSelector'
import ModelComparisonChart from '@/components/ModelComparisonChart'
import DailySummary from '@/components/DailySummary'
import InsightsTable, { type BucketHours } from '@/components/InsightsTable'
import MobileTabBar from '@/components/MobileTabBar'
import SavedLocations from '@/components/SavedLocations'
import ColorLegend from '@/components/ColorLegend'
import ErrorBoundary from '@/components/ErrorBoundary'
import RefreshButton from '@/components/RefreshButton'
import FriendlyHome from '@/components/FriendlyHome'
import WeekForecastPanel from '@/components/WeekForecastPanel'
import DesktopSidebar, { type SidebarSection } from '@/components/DesktopSidebar'
import SettingsPanel from '@/components/SettingsPanel'
import { MODELS, METRICS, MARINE_METRIC_IDS, type MetricId, type WeatherModel, getEnsembleForMetric } from '@/lib/models'
import { fetchForecast, computeForecastDays, type ForecastResult } from '@/lib/openMeteo'
import { useUrlState } from '@/lib/useUrlState'
import { useLocale } from '@/lib/LocaleContext'
import { useTheme } from '@/lib/ThemeContext'
import { STRINGS } from '@/lib/i18n'
import { exportForecastCsv, downloadCsv } from '@/lib/exportCsv'
import { getLocationNow, floorHourLocation, formatLocationTime, formatLocationDate, formatUtcOffset } from '@/lib/dateUtils'
import { reverseGeocode } from '@/lib/reverseGeocode'
import { saveLocalLocation } from '@/lib/localStorageLocations'
import { useRefresh } from '@/lib/useRefresh'
import { usePullToRefresh } from '@/lib/usePullToRefresh'
import { saveLastView, loadLastView } from '@/lib/lastView'
import { saveLastForecast, loadLastForecast } from '@/lib/forecastIndexedDB'

function sliceForecast(data: ForecastResult, startIndex: number): ForecastResult {
  const time = data.time.slice(startIndex)
  const timeStrings = data.timeStrings?.slice(startIndex) ?? time.map(t => t.toISOString())
  const series: ForecastResult['series'] = {}
  for (const modelId of Object.keys(data.series)) {
    const metrics = data.series[modelId]
    const out: typeof metrics = {}
    for (const metricId of Object.keys(metrics)) {
      const arr = metrics[metricId]
      out[metricId] = arr === null ? arr : arr.slice(startIndex)
    }
    series[modelId] = out
  }
  return { time, timeStrings, series, utcOffsetSeconds: data.utcOffsetSeconds }
}

// A new deploy changes the hashed chunk filenames. A browser tab that was
// opened before the deploy still references the old names, so lazy-loading a
// route (e.g. the Stations dashboard) throws a ChunkLoadError when its chunk
// 404s. Recover with a one-shot full reload, which fetches fresh HTML that
// points at the current chunks. Guarded via sessionStorage so we never loop.
function importWithChunkReload<T>(factory: () => Promise<T>): Promise<T> {
  return factory().catch((err: unknown) => {
    const isChunkError =
      err instanceof Error &&
      (err.name === 'ChunkLoadError' ||
        /loading chunk|failed to load chunk|dynamically imported module/i.test(err.message))
    if (isChunkError && typeof window !== 'undefined') {
      const KEY = 'chunkReloadAt'
      const last = Number(sessionStorage.getItem(KEY) || '0')
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(KEY, String(Date.now()))
        window.location.reload()
      }
    }
    throw err
  })
}

const MapPicker = dynamic(() => importWithChunkReload(() => import('@/components/MapPicker')), { ssr: false })
const StationDashboard = dynamic(() => importWithChunkReload(() => import('@/components/StationDashboard')), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
      <div className="animate-spin w-5 h-5 border-2 border-gray-600 border-t-white rounded-full" />
    </div>
  ),
})

const DEFAULT_POS: [number, number] = [41.4500, 2.2475]
const DEFAULT_CITY = 'Badalona'
const DEFAULT_METRIC: MetricId = 'temperature'
const DEFAULT_MODELS = MODELS.map(m => m.id)
// 14-day window is the single supported forecast range; the picker was
// removed from the UI in favour of a fixed horizon. Bump this constant
// if we ever re-introduce the user-facing selector.
const DEFAULT_RANGE = 336
const OPEN_METEO_MAX_DAYS = 16

export default function HomeContent() {
  // M3: keep initial defaults SSR-safe. The `showMap` derivation uses
  // matchMedia which differs between server and client; we apply it in an
  // effect after mount.
  const [defaults] = useState(() => ({
    lat: DEFAULT_POS[0],
    lon: DEFAULT_POS[1],
    metric: DEFAULT_METRIC,
    models: DEFAULT_MODELS,
    hour: 0,
    range: DEFAULT_RANGE,
    showMap: false,
    showRadar: false,
    bucket: 24,
    locale: '',
    marine: false,
    basic: true,
    view: 'weather' as const,
    weekDays: 7 as const,
    ensembleMode: 'wedai' as const,
  }))
  const [urlState, updateUrl] = useUrlState(defaults)

  const [position, setPosition] = useState<[number, number]>([urlState.lat, urlState.lon])
  const [recenterToken, setRecenterToken] = useState(0)
  const [cityName, setCityName] = useState(DEFAULT_CITY)
  const [geoLoading, setGeoLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // Avanzado default is open on both desktop and mobile per product spec.
  // The user explicitly wants to see the table on first paint.
  const [advancedExpanded, setAdvancedExpanded] = useState(true)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const mapSectionRef = useRef<HTMLElement>(null)
  const stationsSectionRef = useRef<HTMLElement>(null)
  const scrollToMapRef = useRef(false)
  const scrollToStationsRef = useRef(false)
  const { locale, toggleLocale } = useLocale()
  const { theme, cycleTheme } = useTheme()
  // S6: shared refresh hook. RefreshButton in the secondary header is
  // the single source of truth for the refresh action. The refresh
  // outcome toast is disabled (see comment near the useEffect that
  // previously set it) so we don't read `lastOutcome` here.
  const { refresh } = useRefresh()
  const queryClient = useQueryClient()

  // S7.5: header collapses on mobile portrait once the user scrolls past the
  // metric pills row, and re-expands when they scroll back up. Disabled on
  // desktop and on mobile-landscape (where the toolbar is already compact).
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false)

  // B10: sync local position / cityName from urlState. This makes back/
  // forward navigation, and any external URL change, actually drive the
  // map and forecast. Only sync when the URL position differs from
  // current to avoid clobbering a user-initiated change that hasn't been
  // written to the URL yet (the debounce in useUrlState means there's
  // a brief window where position is ahead of urlState).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPosition(prev => (prev[0] === urlState.lat && prev[1] === urlState.lon) ? prev : [urlState.lat, urlState.lon])
  }, [urlState.lat, urlState.lon])

  // M-UI-6: persist the user's last view (metric, models, range, …)
  // so that returning later without a URL still restores their
  // preferences. Position is intentionally NOT persisted — it's tied
  // to the city the user picked and they can re-pick it. We save
  // whenever the state changes after the first paint.
  // M-UI-6: persist the user's last view (metric, models, range, ...)
  // so that returning later without a URL still restores their
  // preferences. Position is intentionally NOT persisted — it's tied
  // to the city the user picked and they can re-pick it. We save with a
  // 500ms debounce so a flurry of URL state changes (e.g. dragging the
  // hour slider) doesn't fire a localStorage write on every frame.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      saveLastView({
        metric: urlState.metric,
        models: urlState.models,
        range: urlState.range,
        showMap: urlState.showMap,
        showRadar: urlState.showRadar,
        bucket: (urlState.bucket === 1 || urlState.bucket === 2) ? 24 : urlState.bucket,
        marine: urlState.marine,
        basic: urlState.basic,
      })
    }, 500)
    return () => window.clearTimeout(handle)
  }, [
    urlState.metric, urlState.models, urlState.range,
    urlState.showMap, urlState.showRadar, urlState.bucket,
    urlState.marine, urlState.basic,
  ])

  // M-UI-6 companion: on first mount, if the URL has no params at all
  // (clean /), restore the last-view prefs into URL state. We use a
  // ref to avoid running this more than once.
  const lastViewAppliedRef = useRef(false)
  useEffect(() => {
    if (lastViewAppliedRef.current) return
    lastViewAppliedRef.current = true
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    if ([...sp.keys()].length > 0) return // URL has params; user came from a share
    const saved = loadLastView()
    if (!saved) return
    // Validate models from lastView: filter out any IDs that no longer exist
    const validIds = new Set(MODELS.map(m => m.id))
    const safeModels = saved.models.filter(id => validIds.has(id))
    updateUrl({
      metric: saved.metric,
      models: safeModels.length > 0 ? safeModels : DEFAULT_MODELS,
      range: saved.range,
      showMap: saved.showMap,
      showRadar: saved.showRadar,
      bucket: saved.bucket,
      marine: saved.marine,
      basic: saved.basic,
    })
  }, [updateUrl])

  useEffect(() => {
    if (!mobileMenuOpen) return
    function onDown(e: MouseEvent | TouchEvent) {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [mobileMenuOpen])

  // Close the mobile menu whenever the layout switches to "desktop" (either
  // viewport >= md or landscape orientation on a phone). This prevents the
  // mobile dropdown from staying "open" in state and re-appearing the next
  // time the user rotates back to portrait.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const landscapeMql = window.matchMedia('(orientation: landscape)')
    const desktopMql = window.matchMedia('(min-width: 768px)')
    const onChange = () => {
      if (landscapeMql.matches || desktopMql.matches) {
        setMobileMenuOpen(false)
      }
    }
    onChange()
    landscapeMql.addEventListener('change', onChange)
    desktopMql.addEventListener('change', onChange)
    return () => {
      landscapeMql.removeEventListener('change', onChange)
      desktopMql.removeEventListener('change', onChange)
    }
  }, [])

  // The Avanzado content (InsightsTable, DailySummary,
  // ModelComparisonChart) renders alongside the rest of the page so
  // the user sees the table on first paint per the product spec.

  useEffect(() => {
    if (urlState.locale && urlState.locale !== locale) {
      toggleLocale()
    }
  }, [urlState.locale, locale, toggleLocale])

  // S7.5: collapse the mobile header on scroll. Bound to the window scroll
  // position; we don't need IntersectionObserver since the header is
  // already sticky. Threshold matches the metric-pills row (48 px). We use
  // a ref for the current state so the listener can be wired up once and
  // stay in sync with the latest render.
  const collapsedRef = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    let lastY = window.scrollY
    let frame = 0
    function onScroll() {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        const y = window.scrollY
        if (y > 80 && y > lastY && !collapsedRef.current) {
          collapsedRef.current = true
          setIsHeaderCollapsed(true)
        } else if (y < 40 && y < lastY && collapsedRef.current) {
          collapsedRef.current = false
          setIsHeaderCollapsed(false)
        }
        lastY = y
        frame = 0
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  // M-UI-4: refresh outcome toast is disabled — every URL state change
  // re-renders home-content and the `lastOutcome` ref check would re-fire
  // (we re-created the ref each time) which caused the toast to re-appear
  // whenever the user scrolled the page. The refresh button itself gives
  // visual feedback (spinner, age), so the toast is redundant for the
  // user. We keep the toast for the other actions (save, geolocate error)
  // but never for refresh.

  const selectedMetric = urlState.metric as MetricId
  const selectedModels = urlState.models
  const selectedHour = urlState.hour
  const selectedRange = urlState.range
  const showMap = urlState.showMap
  const showRadar = urlState.showRadar
  const bucket = urlState.bucket as BucketHours
  const marine = urlState.marine
  const showBasic = urlState.basic
  const selectedView: SidebarSection = urlState.view
  const weekDays: 7 | 14 = urlState.weekDays
  const ensembleMode = urlState.ensembleMode

  // Keep `range` in sync with `weekDays` so the forecast fetch covers
  // enough hours for the Próximos días panel regardless of which URL
  // params the user landed on. Without this, a deep link like
  // ?range=168&week=14 silently caps Próximos días to 7 days because the
  // API only returned 7 days of data.
  useEffect(() => {
    const required = weekDays * 24
    if (urlState.range < required) {
      updateUrl({ range: required })
    }
  }, [weekDays, urlState.range, updateUrl])

  // Always fetch the maximum days so DailySummary always has enough data
  // for 14 days regardless of range / weekDays state or past_days offset.
  const forecastDays = OPEN_METEO_MAX_DAYS

  const { data, isLoading, error } = useQuery({
    queryKey: ['forecast', position[0], position[1], forecastDays, marine],
    queryFn: ({ signal }) => fetchForecast(position[0], position[1], MODELS, METRICS, forecastDays, signal, marine),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    // F-5: keep the previous forecast on screen while a new fetch is in
    // flight, so the city-search / range slider don't briefly flash
    // dashes. We only keep the placeholder if the position hasn't
    // changed (i.e. only the range / marine flag toggled).
    placeholderData: (prev, prevQuery) => {
      if (!prev) return prev
      const prevKey = prevQuery?.queryKey as unknown[] | undefined
      if (!prevKey || prevKey[1] !== position[0] || prevKey[2] !== position[1]) {
        return undefined
      }
      return prev
    },
  })

  // F-5: persist every successful forecast to IndexedDB so the user
  // can read their last known data offline. Best-effort; failures are
  // swallowed inside `saveLastForecast`.
  useEffect(() => {
    if (!data) return
    void saveLastForecast({
      position: [position[0], position[1]],
      cityName,
      utcOffsetSeconds: data.utcOffsetSeconds,
      fetchedAt: Date.now(),
      data,
    })
  }, [data, position, cityName])

  // F-5: when the query has errored (offline, timeout, etc.), hydrate from
  // IndexedDB so the app stays useful. Also load proactively on mount if
  // the browser reports offline.
  const [offlineSnapshot, setOfflineSnapshot] = useState<Awaited<ReturnType<typeof loadLastForecast>>>(null)
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    // Load offline data if query errored OR browser is offline
    if (error || !navigator.onLine) {
      void loadLastForecast().then(s => { if (s) setOfflineSnapshot(s) })
    }
  }, [error])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cityName, latitude: position[0], longitude: position[1] }),
      })
      if (!res.ok) throw new Error('Failed to save')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-locations'] })
      setToast(locale === 'en' ? `Saved ${cityName}` : `Guardado ${cityName}`)
    },
    onError: () => {
      saveLocalLocation(cityName, position[0], position[1])
      queryClient.invalidateQueries({ queryKey: ['saved-locations'] })
      setToast(locale === 'en' ? `Saved ${cityName}` : `Guardado ${cityName}`)
    },
  })

  // Mirrors the Cities panel's lookup so we can highlight when the current
  // location is already bookmarked. React Query dedupes by key, so this
  // shares a cache with CitiesList / SavedLocations.
  const { data: savedLocations } = useQuery<{ id: number; name: string; latitude: number; longitude: number }[]>({
    queryKey: ['saved-locations'],
    queryFn: async () => {
      const res = await fetch('/api/locations')
      if (!res.ok) throw new Error('API failed')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const handleCitySelect = useCallback((name: string, lat: number, lon: number) => {
    setCityName(name)
    setPosition([lat, lon])
    setRecenterToken(t => t + 1)
    updateUrl({ lat, lon })
  }, [updateUrl])

  const handlePositionChange = useCallback(async (pos: [number, number]) => {
    setPosition(pos)
    const name = await reverseGeocode(pos[0], pos[1], locale)
    setCityName(name || `${pos[0].toFixed(2)}, ${pos[1].toFixed(2)}`)
    updateUrl({ lat: pos[0], lon: pos[1] })
  }, [updateUrl, locale])

  const handleMetricChange = useCallback((id: MetricId) => {
    updateUrl({ metric: id })
  }, [updateUrl])

  const handleModelChange = useCallback((ids: string[]) => {
    updateUrl({ models: ids })
  }, [updateUrl])

  const handleEnsembleModeChange = useCallback((mode: 'wedai' | 'models') => {
    updateUrl({ ensembleMode: mode })
  }, [updateUrl])

  const handleHourChange = useCallback((hour: number) => {
    updateUrl({ hour })
  }, [updateUrl])

  const handleMapToggle = useCallback(() => {
    if (showMap) {
      // Turning the map off — also switch back to models view so the
      // bottom tab bar reflects Modelos as active.
      updateUrl({ showMap: false, view: 'weather' })
    } else {
      updateUrl({ showMap: true })
    }
  }, [showMap, updateUrl])

  const handleRadarToggle = useCallback(() => {
    updateUrl({ showRadar: !showRadar, showMap: showRadar ? showMap : true })
  }, [showRadar, showMap, updateUrl])

  const handleMarineToggle = useCallback(() => {
    const next = !marine
    const updates: Partial<typeof urlState> = { marine: next }
    if (!next) {
      const currentMetric = urlState.metric as MetricId
      const isMarineMetric = MARINE_METRIC_IDS.includes(currentMetric)
      if (isMarineMetric) updates.metric = DEFAULT_METRIC
    }
    updateUrl(updates)
  }, [marine, urlState.metric, updateUrl])

  const handleBasicToggle = useCallback(() => {
    updateUrl({ basic: !showBasic })
  }, [showBasic, updateUrl])

  const handleBucketChange = useCallback((b: BucketHours) => {
    updateUrl({ bucket: b })
  }, [updateUrl])

  const handleViewSelect = useCallback((section: SidebarSection) => {
    // The map is only visible while the user is on the Mapa nav entry.
    // Selecting Mapa flips showMap on (and scrolls to the section);
    // selecting any other view always flips it off, regardless of how
    // it got turned on (keyboard shortcut, deep link, etc.).
    if (section === 'map') {
      if (!showMap) scrollToMapRef.current = true
      updateUrl({ view: 'map', showMap: true })
    } else {
      updateUrl({ view: section, showMap: false })
    }
  }, [showMap, updateUrl])

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const lat = pos.coords.latitude
        const lon = pos.coords.longitude
        setPosition([lat, lon])
        const name = await reverseGeocode(lat, lon, locale)
        setCityName(name || `${lat.toFixed(2)}, ${lon.toFixed(2)}`)
        setRecenterToken(t => t + 1)
        updateUrl({ lat, lon })
        setGeoLoading(false)
      },
      () => {
        setGeoLoading(false)
        setToast(locale === 'en' ? 'Location access denied' : 'Acceso a ubicación denegado')
      },
      { enableHighAccuracy: false, timeout: 5000 }
    )
  }, [updateUrl, locale])

  const legendMetric = selectedMetric

  // Filter out the virtual marine model only when the marine toggle is
  // *off*. With marine=on we keep every model so that the chart, the
  // Insights table and the friendly cards still compute proper averages
  // and gradients — the InsightsTable hides the basic land columns on
  // its own when `showBasic=false`, so the user keeps the marine view
  // without losing land-model coverage.
  const displayModels = useMemo(
    () => (marine ? MODELS : MODELS.filter(m => m.id !== 'marine_global')),
    [marine]
  )
  const displayActiveModelIds = useMemo(
    () => (marine ? selectedModels : selectedModels.filter(id => id !== 'marine_global')),
    [marine, selectedModels]
  )

  const maxModelHours = useMemo(() => {
    if (selectedModels.length === 0) return 336
    // M12: exclude marine_global from the maxModelHours calculation.
    // marine_global.maxHours is 0 (a placeholder), so if it's the only
    // model the slider would clamp to 0 and the UI breaks. Marine data
    // uses its own forecast_days anyway.
    const land = selectedModels.filter(id => id !== 'marine_global')
    if (land.length === 0) return 336
    return Math.max(...land.map(id => MODELS.find(m => m.id === id)?.maxHours ?? 168))
  }, [selectedModels])

  // Skip hourly entries before the current local hour (rounded down) in the
  // *location's* timezone, not the user's browser timezone.
  const startIndex = useMemo(() => {
    const effectiveData = data ?? offlineSnapshot?.data
    if (!effectiveData?.time?.length) return 0
    const nowFloor = floorHourLocation(getLocationNow(effectiveData.utcOffsetSeconds))
    const nowTs = nowFloor.getTime()
    for (let i = 0; i < effectiveData.time.length; i++) {
      const t = effectiveData.time[i]
      if (t instanceof Date && t.getTime() >= nowTs) return i
    }
    return effectiveData.time.length
  }, [data, offlineSnapshot])

  // Use live data if available, otherwise fall back to offline snapshot
  const effectiveData = data ?? offlineSnapshot?.data ?? null

  const viewData = useMemo(() => {
    if (!effectiveData) return null
    if (startIndex === 0) return effectiveData
    return sliceForecast(effectiveData, startIndex)
  }, [data, offlineSnapshot, startIndex])

  const hourLabel = useMemo(() => {
    const t = viewData?.time?.[selectedHour]
    if (!(t instanceof Date)) return `+${selectedHour}h`
    const hh = formatLocationTime(t, locale, { hour: '2-digit', minute: '2-digit', hour12: false })
    const dd = formatLocationDate(t, locale, { weekday: 'short', day: '2-digit', month: '2-digit' })
    return `${dd} ${hh}`
  }, [viewData, selectedHour, locale])

  const utcOffsetLabel = useMemo(() => {
    if (!effectiveData) return ''
    return formatUtcOffset(effectiveData.utcOffsetSeconds)
  }, [effectiveData])

  const effectiveMaxHours = Math.min(selectedRange, maxModelHours, viewData?.time.length ?? 336)

  // After trimming, hour index 0 IS the current hour by construction.
  const jumpToNow = useCallback(() => {
    handleHourChange(0)
  }, [handleHourChange])

  // S6.3: pull-to-refresh on the main content container. Disabled on
  // desktop (`pointer: coarse` only) and on `prefers-reduced-motion`
  // (the gesture would be janky anyway without an animation).
  const pullToRefreshRef = usePullToRefresh<HTMLDivElement>({
    onRefresh: refresh,
    threshold: 80,
    disabled: typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches,
  })

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleHourChange(Math.max(0, selectedHour - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleHourChange(Math.min(effectiveMaxHours - 1, selectedHour + 1))
      } else if (e.key === '/') {
        e.preventDefault()
        document.getElementById('city-search-input')?.focus()
      } else if (e.key === 'm') {
        // 'm' toggles the map: opens the Mapa view if closed, or returns
        // to Tiempo if the map was already on. Keeps the keyboard shortcut
        // in sync with the new "map only on Mapa view" rule.
        if (showMap) {
          handleViewSelect('weather')
        } else {
          handleViewSelect('map')
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedHour, effectiveMaxHours, handleHourChange, showMap, handleViewSelect])

  // When the mobile tab bar enables the map, scroll the map section into
  // view once it mounts.
  useEffect(() => {
    if (!showMap || !scrollToMapRef.current) return
    scrollToMapRef.current = false
    requestAnimationFrame(() => {
      mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [showMap])

  // When the mobile tab bar switches to stations, scroll the section into view.
  useEffect(() => {
    if (selectedView !== 'stations' || !scrollToStationsRef.current) return
    scrollToStationsRef.current = false
    requestAnimationFrame(() => {
      stationsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [selectedView])

  const mobileTabFromView = selectedView === 'map' ? 'map' : selectedView === 'stations' ? 'stations' : (selectedView === 'weather' || selectedView === 'cities' ? 'models' : 'models')

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground overflow-x-hidden pb-[calc(52px+env(safe-area-inset-bottom))] md:pb-0 landscape:pb-0">
      {/* MOBILE-ONLY: compact top header (search + range pill + refresh). */}
      <div
        data-header-collapsed={isHeaderCollapsed ? 'true' : 'false'}
        className={`md:hidden landscape:hidden sticky top-0 z-[1100] bg-surface-raised border-b border-border shrink-0 px-3 transition-[padding] duration-150 ${
          isHeaderCollapsed ? 'py-1' : 'py-1.5'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0 z-50">
            <CitySearch onSelect={handleCitySelect} />
          </div>
          <div className="shrink-0 flex items-center gap-1.5">
            {/* Top map icon (mobile secondary header) was removed in favour of
                the Mapa entry in the bottom tab bar. */}
          </div>
        </div>
      </div>

      {/* MOBILE-ONLY: secondary header (geo, map toggle, theme, lang, hamburger). */}
      <div ref={mobileMenuRef} className="md:hidden landscape:hidden px-3 py-1.5 bg-surface-raised border-b border-border">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <h1 className="text-xs font-semibold text-text-secondary whitespace-nowrap hidden sm:block">Weather</h1>
          <div className="w-px h-4 bg-border hidden sm:block" />
          <button
            onClick={handleGeolocate}
            disabled={geoLoading}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-50"
            title="Use my location"
            aria-label="Use my location"
          >
            {geoLoading ? (
              <div className="w-3.5 h-3.5 border-2 border-border-strong border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
          <button
            onClick={cycleTheme}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646A9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => { toggleLocale(); updateUrl({ locale: locale === 'en' ? 'es' : 'en' }) }}
            className="min-h-[36px] px-2 rounded text-[11px] font-semibold text-text-secondary hover:text-text-primary transition-colors cursor-pointer tracking-wider"
            title={locale === 'en' ? 'Cambiar a español' : 'Switch to English'}
          >
            {locale === 'en' ? 'ES' : 'EN'}
          </button>
          <RefreshButton />
          <button
            onClick={() => setMobileMenuOpen(o => !o)}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-text-secondary hover:text-text-primary cursor-pointer ml-auto"
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="mt-2 pt-2 border-t border-border space-y-3 animate-fadeIn">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="min-h-[36px] px-3 rounded text-xs font-medium bg-surface-popover text-text-secondary border border-border disabled:opacity-50 cursor-pointer"
              >
                Save
              </button>
              {viewData && (
                <button
                  onClick={() => {
                    const csv = exportForecastCsv(displayModels, viewData.time, viewData.series, effectiveMaxHours, viewData.utcOffsetSeconds)
                    downloadCsv(`forecast-${cityName}-${new Date().toISOString().slice(0, 10)}.csv`, csv)
                  }}
                  className="min-h-[36px] px-3 rounded text-xs font-medium bg-surface-popover text-text-secondary border border-border cursor-pointer"
                >
                  CSV
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        <DesktopSidebar
          active={selectedView}
          onSelect={handleViewSelect}
          layers={{
            showMap,
            showRadar,
            marine,
            showBasic,
          }}
          onLayerToggle={{
            map: handleMapToggle,
            radar: handleRadarToggle,
            marine: handleMarineToggle,
            basic: handleBasicToggle,
          }}
        />

        <main className="flex-1 min-w-0 min-h-0 flex">
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
            {/* Sticky search + range on tablet/desktop, sitting at the top of
                the main column. The metric pills are NOT rendered here — they
                live next to the Map view (which is what they drive). */}
            <div className="hidden md:block sticky top-0 z-[1000] bg-background/95 backdrop-blur border-b border-border px-4 lg:px-6 py-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                  </svg>
                  <CitySearch onSelect={handleCitySelect} />
                </div>
                <RefreshButton />
              </div>
            </div>

            {/* F-5: offline banner — visible only when navigator.onLine is false. */}
            {typeof navigator !== 'undefined' && !navigator.onLine && (
              <div className="mx-4 md:mx-6 mt-3 px-3 py-2 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs">
                {offlineSnapshot
                  ? `${STRINGS[locale].offlineBanner ?? 'Offline'} · ${STRINGS[locale].lastSeen ?? 'last seen'} ${new Date(offlineSnapshot.fetchedAt).toLocaleString()}`
                  : (STRINGS[locale].offlineBanner ?? 'Offline — no cached data')}
              </div>
            )}

            <div
              // eslint-disable-next-line react-hooks/refs
              ref={pullToRefreshRef.ref}
              className="p-3 md:p-4 lg:p-6 space-y-3 md:space-y-4"
            >
              {(selectedView === 'weather' || selectedView === 'cities' || selectedView === 'map' || selectedView === 'stations') && (
                <FriendlyHome
                  city={cityName}
                  cityIsLoading={isLoading && !viewData}
                  models={displayModels}
                  activeIds={displayActiveModelIds}
                  time={viewData?.time ?? []}
                  series={viewData?.series ?? {}}
                  nowIndex={selectedHour}
                  utcOffsetSeconds={viewData?.utcOffsetSeconds ?? 0}
                />
              )}

              {(selectedView === 'weather' || selectedView === 'cities' || selectedView === 'map') && (
                <SavedLocations onSelect={handleCitySelect} />
              )}

              {showMap && selectedView === 'map' && (
                <section ref={mapSectionRef} className="space-y-2">
                  {/* Layer toggles (Map / Radar / Marine / Basic) live just
                      above the map so they're reachable in the same scroll
                      viewport as the map itself on mobile. */}
                  <div
                    role="group"
                    aria-label={STRINGS[locale].layersTitle ?? 'Layers'}
                    className="flex items-center gap-1.5 overflow-x-auto scrollbar-none px-0.5"
                  >
                    <button
                      type="button"
                      onClick={handleMapToggle}
                      aria-pressed={showMap}
                      className={`min-h-[32px] px-3 rounded-full text-[11px] font-medium border transition-colors ${
                        showMap
                          ? 'bg-accent text-white border-accent'
                          : 'bg-surface-popover text-text-secondary border-border'
                      }`}
                    >
                      {STRINGS[locale].map}
                    </button>
                    <button
                      type="button"
                      onClick={handleRadarToggle}
                      aria-pressed={showRadar}
                      className={`min-h-[32px] px-3 rounded-full text-[11px] font-medium border transition-colors ${
                        showRadar
                          ? 'bg-sky-500 text-white border-sky-500'
                          : 'bg-surface-popover text-text-secondary border-border'
                      }`}
                    >
                      {STRINGS[locale].radar}
                    </button>
                    <button
                      type="button"
                      onClick={handleMarineToggle}
                      aria-pressed={marine}
                      className={`min-h-[32px] px-3 rounded-full text-[11px] font-medium border transition-colors ${
                        marine
                          ? 'bg-cyan-500 text-white border-cyan-500'
                          : 'bg-surface-popover text-text-secondary border-border'
                      }`}
                    >
                      {STRINGS[locale].marine}
                    </button>
                    {marine && (
                      <button
                        type="button"
                        onClick={handleBasicToggle}
                        aria-pressed={showBasic}
                        className={`min-h-[32px] px-3 rounded-full text-[11px] font-medium border transition-colors ${
                          showBasic
                            ? 'bg-emerald-500 text-white border-emerald-500'
                            : 'bg-surface-popover text-text-secondary border-border'
                        }`}
                      >
                        {STRINGS[locale].basic}
                      </button>
                    )}
                  </div>
                  {/* Metric pills drive what the heatmap shows. They live
                      next to the layers on every layout. */}
                  <div
                    role="group"
                    aria-label={STRINGS[locale].groupView}
                    className="flex items-center gap-1.5 overflow-x-auto scrollbar-none px-0.5"
                  >
                    {(showBasic || !marine) && <MetricPills metrics={METRICS} selected={selectedMetric} onChange={handleMetricChange} group="land" />}
                    {marine && <MetricPills metrics={METRICS} selected={selectedMetric} onChange={handleMetricChange} group="marine" />}
                  </div>
                  <div className="h-[40vh] min-h-[260px] max-h-[440px] rounded-2xl border border-border bg-surface-raised relative overflow-hidden">
                    <MapPicker
                      position={position}
                      recenterToken={recenterToken}
                      onPositionChange={handlePositionChange}
                      showHeatmap={showMap}
                      metric={selectedMetric}
                      selectedModels={displayActiveModelIds.filter(id => id !== 'marine_global')}
                      hourIndex={selectedHour}
                      nowOffset={startIndex}
                      showRadar={showRadar}
                    />
                    <div className="absolute bottom-2.5 left-2.5 z-[1050] bg-surface-raised/90 p-2 rounded-lg shadow-lg pointer-events-none">
                      <ColorLegend metric={legendMetric} />
                    </div>
                  </div>
                </section>
              )}

              {showMap && selectedView === 'map' && (
                <div className="rounded-2xl border border-border bg-surface-raised p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] text-text-secondary font-mono">{hourLabel}</span>
                    <span className="text-[10px] text-text-tertiary">+{selectedHour}h</span>
                    {utcOffsetLabel ? (
                      <span className="text-[10px] text-text-tertiary ml-auto">{utcOffsetLabel}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleHourChange(Math.max(0, selectedHour - 1))}
                      className="min-h-[36px] px-2.5 bg-surface-popover hover:bg-surface text-text-primary rounded text-xs cursor-pointer transition-colors"
                      aria-label="Previous hour"
                    >−1h</button>
                    <button
                      onClick={() => handleHourChange(Math.max(0, selectedHour - 24))}
                      className="min-h-[36px] px-2.5 bg-surface-popover hover:bg-surface text-text-primary rounded text-xs cursor-pointer transition-colors hidden sm:inline-flex"
                      aria-label="Previous day"
                    >−24h</button>
                    <input
                      type="range"
                      min={0}
                      max={effectiveMaxHours - 1}
                      value={selectedHour}
                      onChange={e => handleHourChange(Number(e.target.value))}
                      className="flex-1 min-w-0"
                      aria-label="Forecast hour"
                      aria-valuetext={hourLabel}
                    />
                    <button
                      onClick={() => handleHourChange(Math.min(effectiveMaxHours - 1, selectedHour + 24))}
                      className="min-h-[36px] px-2.5 bg-surface-popover hover:bg-surface text-text-primary rounded text-xs cursor-pointer transition-colors hidden sm:inline-flex"
                      aria-label="Next day"
                    >+24h</button>
                    <button
                      onClick={() => handleHourChange(Math.min(effectiveMaxHours - 1, selectedHour + 1))}
                      className="min-h-[36px] px-2.5 bg-surface-popover hover:bg-surface text-text-primary rounded text-xs cursor-pointer transition-colors"
                      aria-label="Next hour"
                    >+1h</button>
                    <button
                      onClick={jumpToNow}
                      className="min-h-[36px] px-2.5 bg-surface-popover hover:bg-surface text-text-primary rounded text-xs cursor-pointer transition-colors"
                      aria-label="Jump to current hour"
                    >Now</button>
                  </div>
                </div>
              )}

              {selectedView === 'weather' && (
                <AdvancedSection
                  expanded={advancedExpanded}
                  onToggle={() => setAdvancedExpanded(o => !o)}
                  displayModels={displayModels}
                  displayActiveModelIds={displayActiveModelIds}
                  selectedModels={selectedModels}
                  selectedHour={selectedHour}
                  viewData={viewData}
                  fullData={effectiveData}
                  startIndex={startIndex}
                  effectiveMaxHours={effectiveMaxHours}
                  bucket={bucket}
                  marine={marine}
                  onMarineToggle={handleMarineToggle}
                  showBasic={showBasic}
                  onBasicToggle={handleBasicToggle}
                  selectedMetric={selectedMetric}
                  onModelChange={handleModelChange}
                  onHourChange={handleHourChange}
                  onBucketChange={handleBucketChange}
                  ensembleMode={ensembleMode}
                  onEnsembleModeChange={handleEnsembleModeChange}
                  weekDays={weekDays}
                />
              )}

              {selectedView === 'cities' && (
                <section className="rounded-2xl border border-border bg-surface-raised p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary mb-1">
                      {locale === 'en' ? 'Cities' : 'Ciudades'}
                    </h3>
                    <p className="text-xs text-text-tertiary">
                      {locale === 'en'
                        ? 'Manage your saved locations. Tap one to jump to it.'
                        : 'Gestiona tus ubicaciones guardadas. Toca una para ir a ella.'}
                    </p>
                  </div>
                  <CitiesList
                    onSelect={handleCitySelect}
                    currentCityName={cityName}
                    currentCityId={(() => {
                      // Match by name + ~50m coordinate tolerance so a re-load
                      // of the same place is recognised as already-saved.
                      const around = savedLocations?.find(l =>
                        l.name === cityName &&
                        Math.abs(l.latitude - position[0]) < 0.0005 &&
                        Math.abs(l.longitude - position[1]) < 0.0005
                      )
                      return around?.id
                    })()}
                    onSaveCurrent={() => saveMutation.mutate()}
                    saving={saveMutation.isPending}
                  />
                </section>
              )}

              {selectedView === 'stations' && (
                <section ref={stationsSectionRef}>
                <ErrorBoundary
                  fallback={
                    <div className="text-center py-10" role="alert">
                      <p className="text-sm text-red-400">{STRINGS[locale].stationError}</p>
                      <button
                        onClick={() => window.location.reload()}
                        className="mt-2 text-xs text-text-tertiary hover:text-text-secondary underline cursor-pointer"
                      >
                        {STRINGS[locale].retry}
                      </button>
                    </div>
                  }
                >
                  <StationDashboard position={position} placeName={cityName} />
                </ErrorBoundary>
                </section>
              )}

              {selectedView === 'settings' && (
                <SettingsPanel
                  marine={marine}
                  onMarineToggle={handleMarineToggle}
                  showBasic={showBasic}
                  onBasicToggle={handleBasicToggle}
                  cityName={cityName}
                  positionLat={position[0]}
                  positionLon={position[1]}
                  viewData={viewData ? { time: viewData.time, series: viewData.series, utcOffsetSeconds: viewData.utcOffsetSeconds } : null}
                  displayModels={displayModels}
                  effectiveMaxHours={effectiveMaxHours}
                  selectedMetric={selectedMetric}
                />
              )}
            </div>
          </div>

          <aside
            aria-label={STRINGS[locale].weekTitle}
            className="hidden lg:block w-[320px] shrink-0 border-l border-border overflow-y-auto"
            style={{ maxHeight: 'calc(100dvh)' }}
          >
            <div className="p-4 xl:p-5 space-y-4 xl:sticky xl:top-0">
              <WeekForecastPanel
                models={displayModels}
                activeIds={displayActiveModelIds}
                time={effectiveData?.time ?? []}
                series={effectiveData?.series ?? {}}
                nowIndex={startIndex + selectedHour}
                maxHours={Math.max(startIndex + selectedHour, 0) + weekDays * 24}
                weekDays={weekDays}
                onWeekDaysChange={(d) => {
                  // WeekForecastPanel needs `range` to cover `weekDays * 24`
                  // hours of forecast data; bumping one without the other
                  // silently caps the panel to fewer days than requested.
                  const requiredHours = d * 24
                  updateUrl({
                    weekDays: d,
                    range: Math.max(requiredHours, urlState.range),
                  })
                }}
                onSelectHour={handleHourChange}
              />
            </div>
          </aside>
        </main>
      </div>

      {/* F-9: footer keyboard hints, hidden on mobile (mobile tab bar lives at the bottom). */}
      <div className="hidden md:flex md:mt-auto px-3 py-0.5 bg-surface/50 border-t border-border text-[9px] text-text-tertiary gap-3 shrink-0">
        <span>← → {STRINGS[locale].footerHours}</span>
        <span>/ {STRINGS[locale].footerSearch}</span>
        <span>m {STRINGS[locale].footerMap}</span>
      </div>

      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[2000] bg-surface-popover border border-border text-text-primary text-xs px-3 py-1.5 rounded-md shadow-lg animate-fadeIn"
          style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
        >
          {toast}
        </div>
      )}

      <MobileTabBar
        active={mobileTabFromView}
        onChange={(next) => {
          // handleViewSelect keeps showMap in sync with the Mapa nav —
          // selecting Map enables it, any other view disables it.
          if (next === 'map') {
            handleViewSelect('map')
          } else if (next === 'stations') {
            scrollToStationsRef.current = true
            handleViewSelect('stations')
          } else {
            handleViewSelect('weather')
          }
        }}
      />
    </div>
  )
}

function CitiesList({
  onSelect,
  currentCityName,
  currentCityId,
  onSaveCurrent,
  saving,
}: {
  onSelect: (name: string, lat: number, lon: number) => void
  currentCityName: string
  currentCityId?: number
  onSaveCurrent: () => void
  saving: boolean
}) {
  // Saved-cities panel for the Ciudades sidebar entry. Renders the user's
  // bookmarked locations with a "Save city" CTA so the current weather view
  // can be bookmarked without leaving the friendly layout.
  const { locale } = useLocale()
  const s = STRINGS[locale]
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['saved-locations'],
    queryFn: async () => {
      const res = await fetch('/api/locations')
      if (!res.ok) throw new Error('API failed')
      return res.json() as Promise<{ id: number; name: string; latitude: number; longitude: number }[]>
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/locations?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('API failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-locations'] }),
  })

  const empty = !data || data.length === 0

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onSaveCurrent}
        disabled={saving || currentCityId !== undefined}
        aria-label={s.citiesSaveCurrent}
        className={`w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
          currentCityId !== undefined
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
            : 'border-border bg-accent text-white hover:bg-accent-hover disabled:opacity-60'
        }`}
      >
        <span className="flex flex-col">
          <span className="text-sm font-semibold">{s.citiesSaveCurrent}</span>
          <span
            className={`text-xs truncate ${currentCityId !== undefined ? 'text-emerald-300/80' : 'text-white/80'}`}
          >
            {currentCityName}
          </span>
        </span>
        {saving ? (
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : currentCityId !== undefined ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
      </button>

      {isLoading ? (
        <p className="text-sm text-text-tertiary">{s.loadingStations}</p>
      ) : empty ? (
        <p className="text-sm text-text-tertiary">
          {s.citiesEmpty} {s.citiesEmptyHint}
        </p>
      ) : (
        <ul className="space-y-1">
          {data!.map(loc => (
            <li
              key={loc.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <button
                onClick={() => onSelect(loc.name, loc.latitude, loc.longitude)}
                className="min-h-[36px] flex-1 text-left text-sm text-text-primary hover:text-accent transition-colors"
              >
                {loc.name}
                <span className="block text-xs text-text-tertiary tabular-nums">
                  {loc.latitude.toFixed(2)}, {loc.longitude.toFixed(2)}
                </span>
              </button>
              <button
                onClick={() => deleteMutation.mutate(loc.id)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-text-tertiary hover:text-red-400 transition-colors"
                aria-label={`Remove ${loc.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Avanzado (model selector + Insights table + comparison chart) is
 * wrapped in a memoised component so the heavy subtree only re-renders
 * when one of its actual props changes. Without this memo, every URL
 * state change (e.g. toggling a model) re-runs the DailySummary,
 * InsightsTable and ModelComparisonChart tree, which is the dominant
 * cost on slow mobile.
 */
const AdvancedSection = memo(function AdvancedSection({
  expanded,
  onToggle,
  displayModels,
  displayActiveModelIds,
  selectedModels,
  selectedHour,
  viewData,
  fullData,
  startIndex,
  effectiveMaxHours,
  bucket,
  marine,
  onMarineToggle,
  showBasic,
  onBasicToggle,
  selectedMetric,
  onModelChange,
  onHourChange,
  onBucketChange,
  ensembleMode,
  onEnsembleModeChange,
  weekDays,
}: {
  expanded: boolean
  onToggle: () => void
  displayModels: WeatherModel[]
  displayActiveModelIds: string[]
  selectedModels: string[]
  selectedHour: number
  viewData: ReturnType<typeof sliceForecast> | NonNullable<Awaited<ReturnType<typeof fetchForecast>>> | null
  fullData: NonNullable<Awaited<ReturnType<typeof fetchForecast>>> | null
  startIndex: number
  effectiveMaxHours: number
  bucket: BucketHours
  marine: boolean
  onMarineToggle: () => void
  showBasic: boolean
  onBasicToggle: () => void
  selectedMetric: MetricId
  onModelChange: (ids: string[]) => void
  onHourChange: (hour: number) => void
  onBucketChange: (b: BucketHours) => void
  ensembleMode: 'wedai' | 'models'
  onEnsembleModeChange: (mode: 'wedai' | 'models') => void
  weekDays: 7 | 14
}) {
  const { locale } = useLocale()
  const s = STRINGS[locale]
  // Pre-extract the dense props so the JSX below is readable.
  const viewTimes = viewData?.time ?? []
  const viewSeries = viewData?.series ?? {}
  const viewUtc = viewData?.utcOffsetSeconds ?? 0
  // Use full (untrimmed) data for DailySummary so it can show all 14 days
  // from the start of the forecast, not just from the current hour.
  const fullTimes = fullData?.time ?? []
  const fullSeries = fullData?.series ?? {}
  const fullUtc = fullData?.utcOffsetSeconds ?? 0

  return (
    <section className="rounded-2xl border border-border bg-surface-raised overflow-hidden">
      {/* Mobile (< md): tap the header to toggle the Avanzado section. */}
      <button
        type="button"
        onClick={onToggle}
        className="md:hidden w-full px-4 py-3 flex items-center justify-between text-text-primary hover:bg-surface-popover/40 transition-colors cursor-pointer"
        aria-expanded={expanded}
        aria-controls="advanced-section"
      >
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-semibold text-text-tertiary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
            <path d="M3 17l6-6 4 4 8-8" />
            <path d="M14 7h7v7" />
          </svg>
          {s.navAdvanced}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={`w-4 h-4 text-text-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {/* Desktop (>= md): collapsible header. */}
      <button
        type="button"
        onClick={onToggle}
        className="hidden md:flex w-full items-center justify-between px-4 py-3 text-text-primary hover:bg-surface-popover/40 transition-colors"
        aria-expanded={expanded}
        aria-controls="advanced-section"
      >
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-semibold text-text-tertiary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
            <path d="M3 17l6-6 4 4 8-8" />
            <path d="M14 7h7v7" />
          </svg>
          {s.navAdvanced}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={`w-4 h-4 text-text-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {expanded ? (
        <div id="advanced-section" className="px-4 pb-4 space-y-3">
          <DailySummary
            models={displayModels}
            activeModelIds={displayActiveModelIds}
            times={fullTimes}
            series={fullSeries}
            selectedHour={startIndex + selectedHour}
            onSelectHour={(hour) => onHourChange(hour - startIndex)}
            // Show exactly `weekDays` calendar days: remainder of the
            // current day + (weekDays - 1) full days. When startIndex falls
            // on midnight we count the full current day (24 h). Any indices
            // past the array are naturally dropped by DailySummary.
            maxHours={(() => {
              const rem = startIndex % 24
              const toMidnight = rem === 0 ? 24 : 24 - rem
              return Math.min(fullTimes.length, startIndex + toMidnight + (weekDays - 1) * 24)
            })()}
            showMarine={marine}
            showBasic={showBasic}
            utcOffsetSeconds={fullUtc}
            startIndex={startIndex}
          />
          <ModelSelector
            models={displayModels}
            selected={selectedModels}
            onChange={onModelChange}
            ensembleMode={ensembleMode}
            onEnsembleModeChange={onEnsembleModeChange}
          />
          <InsightsTable
            models={displayModels}
            activeModelIds={displayActiveModelIds}
            times={viewTimes}
            series={viewSeries}
            bucket={bucket}
            onBucketChange={onBucketChange}
            selectedHour={selectedHour}
            onSelectHour={onHourChange}
            maxHours={viewTimes.length || effectiveMaxHours}
            utcOffsetSeconds={viewUtc}
            showMarine={marine}
            onMarineToggle={onMarineToggle}
            showBasic={showBasic}
            onBasicToggle={onBasicToggle}
            ensembleMode={ensembleMode}
          />
          <ModelComparisonChart
            models={displayModels}
            activeModelIds={displayActiveModelIds}
            metric={selectedMetric}
            times={viewTimes}
            series={viewSeries}
            onHourHover={onHourChange}
            hoveredHour={selectedHour}
            maxHours={viewTimes.length || effectiveMaxHours}
            ensembleMode={ensembleMode}
          />
        </div>
      ) : null}
    </section>
  )
})

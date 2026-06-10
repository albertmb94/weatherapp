'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { useSwipeGesture } from '@/lib/useSwipeGesture'
import CitySearch from '@/components/CitySearch'
import MetricPills from '@/components/MetricPills'
import ModelSelector from '@/components/ModelSelector'
import TimeRangeSelector from '@/components/TimeRangeSelector'
import ModelComparisonChart from '@/components/ModelComparisonChart'
import DailySummary from '@/components/DailySummary'
import InsightsTable, { type BucketHours } from '@/components/InsightsTable'
import SavedLocations from '@/components/SavedLocations'
import ColorLegend from '@/components/ColorLegend'
import RefreshButton from '@/components/RefreshButton'
import { DailySummarySkeleton, InsightsSkeleton, ChartSkeleton } from '@/components/Skeletons'
import { MODELS, METRICS, MARINE_METRIC_IDS, type MetricId } from '@/lib/models'
import { fetchForecast, computeForecastDays, type ForecastResult } from '@/lib/openMeteo'
import { useUrlState } from '@/lib/useUrlState'
import { useLocale } from '@/lib/LocaleContext'
import { useTheme } from '@/lib/ThemeContext'
import { STRINGS } from '@/lib/i18n'
import { exportForecastCsv, downloadCsv } from '@/lib/exportCsv'
import { getLocationNow, floorHourLocation, formatLocationTime, formatLocationDate, formatUtcOffset } from '@/lib/dateUtils'
import { reverseGeocode } from '@/lib/reverseGeocode'
import { saveLocalLocation } from '@/lib/localStorageLocations'
import { formatAge } from '@/lib/formatAge'

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

const MapPicker = dynamic(() => import('@/components/MapPicker'), { ssr: false })
const StationDashboard = dynamic(() => import('@/components/StationDashboard'), { ssr: false })

const DEFAULT_POS: [number, number] = [41.4500, 2.2475]
const DEFAULT_CITY = 'Badalona'
const DEFAULT_METRIC: MetricId = 'temperature'
const DEFAULT_MODELS = MODELS.map(m => m.id)
const DEFAULT_RANGE = 168
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
    showMap: true,
    showRadar: false,
    bucket: 4,
    locale: '',
    marine: false,
    basic: true,
  }))
  const [urlState, updateUrl] = useUrlState(defaults)

  const [position, setPosition] = useState<[number, number]>([urlState.lat, urlState.lon])
  const [recenterToken, setRecenterToken] = useState(0)
  const [cityName, setCityName] = useState(DEFAULT_CITY)
  const [geoLoading, setGeoLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const { locale, toggleLocale } = useLocale()
  const { theme, toggleTheme } = useTheme()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'models' | 'stations'>('models')

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

  useEffect(() => {
    if (urlState.locale && urlState.locale !== locale) {
      toggleLocale()
    }
  }, [urlState.locale, locale, toggleLocale])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const selectedMetric = urlState.metric as MetricId
  const selectedModels = urlState.models
  const selectedHour = urlState.hour
  const selectedRange = urlState.range
  const showMap = urlState.showMap
  const showRadar = urlState.showRadar
  const bucket = urlState.bucket as BucketHours
  const marine = urlState.marine
  const showBasic = urlState.basic

  const { data: refreshStatus } = useQuery<{ lastRefreshedAt: number | null; ageMs: number | null }>({
    queryKey: ['refresh-status'],
    queryFn: async () => {
      const res = await fetch('/api/refresh')
      if (!res.ok) throw new Error('refresh status')
      return res.json()
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  })

  const forecastDays = computeForecastDays(selectedRange, OPEN_METEO_MAX_DAYS)

  const { data, isLoading, error } = useQuery({
    queryKey: ['forecast', position[0], position[1], forecastDays, marine],
    queryFn: ({ signal }) => fetchForecast(position[0], position[1], MODELS, METRICS, forecastDays, signal, marine),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

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

  const handleRangeChange = useCallback((hours: number) => {
    updateUrl({ range: hours })
  }, [updateUrl])

  const handleHourChange = useCallback((hour: number) => {
    updateUrl({ hour })
  }, [updateUrl])

  const handleMapToggle = useCallback(() => {
    updateUrl({ showMap: !showMap })
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

  const legendMetric: Exclude<MetricId, 'all'> = selectedMetric === 'all' ? 'temperature' : selectedMetric

  // Filter out the virtual marine model when the marine toggle is off, so
  // it does not appear in the model selector, comparison chart, or daily
  // summary. The wave data itself only lives on `series.marine_global` and
  // is consumed directly by InsightsTable / DailySummary when marine is on.
  const displayModels = useMemo(
    () => {
      if (!marine) return MODELS.filter(m => m.id !== 'marine_global')
      if (!showBasic) return MODELS.filter(m => m.id === 'marine_global')
      return MODELS
    },
    [marine, showBasic]
  )
  const displayActiveModelIds = useMemo(
    () => {
      if (!marine) return selectedModels.filter(id => id !== 'marine_global')
      if (!showBasic) return selectedModels.filter(id => id === 'marine_global')
      return selectedModels
    },
    [marine, showBasic, selectedModels]
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
    if (!data?.time?.length) return 0
    const nowFloor = floorHourLocation(getLocationNow(data.utcOffsetSeconds))
    const nowTs = nowFloor.getTime()
    for (let i = 0; i < data.time.length; i++) {
      const t = data.time[i]
      if (t instanceof Date && t.getTime() >= nowTs) return i
    }
    return data.time.length
  }, [data])

  const viewData = useMemo(() => {
    if (!data) return null
    if (startIndex === 0) return data
    return sliceForecast(data, startIndex)
  }, [data, startIndex])

  const hourLabel = useMemo(() => {
    const t = viewData?.time?.[selectedHour]
    if (!(t instanceof Date)) return `+${selectedHour}h`
    const hh = formatLocationTime(t, locale, { hour: '2-digit', minute: '2-digit', hour12: false })
    const dd = formatLocationDate(t, locale, { weekday: 'short', day: '2-digit', month: '2-digit' })
    return `${dd} ${hh}`
  }, [viewData, selectedHour, locale])

  const utcOffsetLabel = useMemo(() => {
    if (!data) return ''
    return formatUtcOffset(data.utcOffsetSeconds)
  }, [data])

  const effectiveMaxHours = Math.min(selectedRange, maxModelHours, viewData?.time.length ?? 336)

  // After trimming, hour index 0 IS the current hour by construction.
  const jumpToNow = useCallback(() => {
    handleHourChange(0)
  }, [handleHourChange])

  const swipeRef = useSwipeGesture<HTMLDivElement>({
    onSwipeLeft: () => handleHourChange(Math.min(effectiveMaxHours - 1, selectedHour + 1)),
    onSwipeRight: () => handleHourChange(Math.max(0, selectedHour - 1)),
    threshold: 50,
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
        handleMapToggle()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedHour, effectiveMaxHours, handleHourChange, handleMapToggle])

  return (
    <div className="min-h-screen flex flex-col bg-gray-950 text-white overflow-x-clip">
      <div className="sticky top-0 z-30 bg-gray-900 border-b border-gray-800 shrink-0 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <CitySearch onSelect={handleCitySelect} />
          </div>
          <TimeRangeSelector selected={selectedRange} onChange={handleRangeChange} maxAvailable={maxModelHours} showLabel={false} />
        </div>
        {refreshStatus?.lastRefreshedAt && (
          <div className="md:hidden mt-0.5 text-[9px] text-gray-600">
            {locale === 'en' ? 'Updated' : 'Actualizado'} {formatAge(refreshStatus.ageMs ?? null, locale)}
          </div>
        )}
      </div>

      {marine && (
        <div className="md:hidden landscape:hidden px-2 py-1 bg-gray-900 border-b border-gray-800 overflow-x-auto flex-shrink-0">
          <div className="flex items-center gap-1 min-w-max">
            {showBasic && (
              <MetricPills metrics={METRICS} selected={selectedMetric} onChange={handleMetricChange} group="land" />
            )}
            <MetricPills metrics={METRICS} selected={selectedMetric} onChange={handleMetricChange} group="marine" />
          </div>
        </div>
      )}

      <div ref={mobileMenuRef} className="px-3 py-1.5 bg-gray-900 border-b border-gray-800">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <h1 className="text-xs font-semibold text-gray-400 whitespace-nowrap hidden sm:block">Weather</h1>
          <div className="w-px h-4 bg-gray-800 hidden sm:block" />
          <button
            onClick={handleGeolocate}
            disabled={geoLoading}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-500 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
            title="Use my location"
            aria-label="Use my location"
          >
            {geoLoading ? (
              <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
          <button
            onClick={handleMapToggle}
            className={`md:hidden landscape:hidden min-h-[36px] min-w-[36px] flex items-center justify-center transition-colors cursor-pointer ${
              showMap ? 'text-white' : 'text-gray-500 hover:text-white'
            }`}
            title="Toggle map"
            aria-label="Toggle map"
            aria-pressed={showMap}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.553 2.776A1 1 0 0022 18.882V8.118a1 1 0 00-1.447-.894L15 10m0 7V10m0 0L9 7" />
            </svg>
          </button>
          <div className="hidden md:flex landscape:flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {(showBasic || !marine) && <MetricPills metrics={METRICS} selected={selectedMetric} onChange={handleMetricChange} group="land" />}
            {marine && <MetricPills metrics={METRICS} selected={selectedMetric} onChange={handleMetricChange} group="marine" />}
            <button
              onClick={handleMapToggle}
              className={`min-h-[32px] px-2 rounded text-[11px] font-medium transition-all cursor-pointer ${
                showMap ? 'text-white' : 'text-gray-600 hover:text-gray-300'
              }`}
            >
              Map
            </button>
            <button
              onClick={handleRadarToggle}
              className={`min-h-[32px] px-2 rounded text-[11px] font-medium transition-all cursor-pointer ${
                showRadar ? 'text-sky-300' : 'text-gray-600 hover:text-gray-300'
              }`}
              title="Toggle rain radar (RainViewer)"
            >
              Radar
            </button>
            <div className="w-px h-4 bg-gray-700" />
            <button
              onClick={handleMarineToggle}
              className={`min-h-[32px] px-2.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer border ${
                marine ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40' : 'bg-gray-800/50 text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-600'
              }`}
              title="Marine/wave data (Open-Meteo)"
              aria-pressed={marine}
            >
              Marine
            </button>
            {marine && (
              <button
                onClick={handleBasicToggle}
                className={`min-h-[32px] px-2.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer border ${
                  showBasic ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40' : 'bg-gray-800/50 text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-600'
                }`}
                title="Basic land stats (temperature, wind, etc.)"
                aria-pressed={showBasic}
              >
                Basic
              </button>
            )}
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="min-h-[32px] px-2 rounded text-[11px] font-medium text-gray-500 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              Save
            </button>
            {viewData && (
              <button
                onClick={() => {
                  const csv = exportForecastCsv(displayModels, viewData.time, viewData.series, effectiveMaxHours)
                  downloadCsv(`forecast-${cityName}-${new Date().toISOString().slice(0, 10)}.csv`, csv)
                }}
                className="min-h-[32px] px-2 rounded text-[11px] font-medium text-gray-500 hover:text-white transition-colors cursor-pointer"
                title="Export forecast to CSV"
              >
                CSV
              </button>
            )}
            {typeof navigator !== 'undefined' && 'share' in navigator && viewData && (
              <button
                onClick={() => {
                  navigator.share({
                    title: `Weather ${cityName}`,
                    url: window.location.href,
                  }).catch(() => {})
                }}
                className="min-h-[32px] px-2 rounded text-[11px] font-medium text-gray-500 hover:text-white transition-colors cursor-pointer"
                title="Share"
              >
                Share
              </button>
            )}
            <button
              onClick={toggleTheme}
              className="min-w-[32px] min-h-[32px] flex items-center justify-center text-gray-400 hover:text-white transition-colors cursor-pointer"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            <button
              onClick={() => { toggleLocale(); updateUrl({ locale: locale === 'en' ? 'es' : 'en' }) }}
              className="min-h-[32px] px-2 rounded text-[11px] font-semibold text-gray-400 hover:text-white transition-colors cursor-pointer tracking-wider"
              title={locale === 'en' ? 'Cambiar a español' : 'Switch to English'}
            >
              {locale === 'en' ? 'ES' : 'EN'}
            </button>
            <RefreshButton />
            <span className="text-[10px] text-gray-600 ml-auto truncate max-w-[160px]">{cityName} ({position[0].toFixed(2)}, {position[1].toFixed(2)})</span>
          </div>
          <button
            onClick={() => setMobileMenuOpen(o => !o)}
            className="md:hidden landscape:hidden min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-400 hover:text-white cursor-pointer ml-auto"
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
          <div className="md:hidden landscape:hidden mt-2 pt-2 border-t border-gray-800 space-y-3 animate-fadeIn">
            <div>
              {(showBasic || !marine) && (
                <>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Basic</span>
                  <MetricPills metrics={METRICS} selected={selectedMetric} onChange={handleMetricChange} group="land" />
                </>
              )}
              {marine && (
                <div className={showBasic ? 'mt-1' : ''}>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Marine</span>
                  <MetricPills metrics={METRICS} selected={selectedMetric} onChange={handleMetricChange} group="marine" />
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleRadarToggle}
                className={`min-h-[36px] px-3 rounded text-xs font-medium transition-all cursor-pointer ${
                  showRadar ? 'bg-sky-600/30 text-sky-200 border border-sky-500/50' : 'bg-gray-800 text-gray-400 border border-gray-700'
                }`}
              >
                Radar
              </button>
              <button
                onClick={handleMarineToggle}
                className={`min-h-[36px] px-3 rounded text-xs font-semibold transition-all cursor-pointer border ${
                  marine ? 'bg-cyan-600/30 text-cyan-200 border-cyan-500/50' : 'bg-gray-800 text-gray-400 border-gray-700'
                }`}
                aria-pressed={marine}
              >
                Marine
              </button>
              {marine && (
                <button
                  onClick={handleBasicToggle}
                  className={`min-h-[36px] px-3 rounded text-xs font-semibold transition-all cursor-pointer border ${
                    showBasic ? 'bg-emerald-600/30 text-emerald-200 border-emerald-500/50' : 'bg-gray-800 text-gray-400 border-gray-700'
                  }`}
                  aria-pressed={showBasic}
                >
                  Basic
                </button>
              )}
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="min-h-[36px] px-3 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 disabled:opacity-50 cursor-pointer"
              >
                Save
              </button>
              {viewData && (
                <button
                  onClick={() => {
                    const csv = exportForecastCsv(displayModels, viewData.time, viewData.series, effectiveMaxHours)
                    downloadCsv(`forecast-${cityName}-${new Date().toISOString().slice(0, 10)}.csv`, csv)
                  }}
                  className="min-h-[36px] px-3 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 cursor-pointer"
                >
                  CSV
                </button>
              )}
              <RefreshButton />
              <button
                onClick={toggleTheme}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center bg-gray-800 text-gray-400 border border-gray-700 rounded cursor-pointer"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => { toggleLocale(); updateUrl({ locale: locale === 'en' ? 'es' : 'en' }) }}
                className="min-h-[36px] px-3 rounded text-xs font-semibold bg-gray-800 text-gray-400 border border-gray-700 cursor-pointer tracking-wider"
              >
                {locale === 'en' ? 'ES' : 'EN'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col">
        <SavedLocations onSelect={handleCitySelect} />

        {showMap && (
          <div className="h-[40vh] min-h-[260px] max-h-[440px] p-1.5 border-b border-gray-800 relative shrink-0">
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
            <div className="absolute bottom-2.5 left-2.5 z-[1000] bg-gray-900/90 p-2 rounded-lg shadow-lg pointer-events-none">
              <ColorLegend metric={legendMetric} />
            </div>
          </div>
        )}

        {showMap && (
          <div className="bg-gray-900/60 border-b border-gray-800 px-2 py-1.5 shrink-0">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px] text-gray-400 font-mono">{hourLabel}</span>
              <span className="text-[10px] text-gray-600">+{selectedHour}h</span>
              {utcOffsetLabel && (
                <span className="text-[10px] text-gray-600 ml-auto">{utcOffsetLabel}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleHourChange(Math.max(0, selectedHour - 1))}
                className="min-h-[36px] px-2 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer transition-colors"
                aria-label="Previous hour"
              >−1h</button>
              <button
                onClick={() => handleHourChange(Math.max(0, selectedHour - 24))}
                className="min-h-[36px] px-2 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer transition-colors"
                aria-label="Previous day"
              >−24h</button>
              <input
                type="range"
                min={0}
                max={effectiveMaxHours - 1}
                value={selectedHour}
                onChange={e => handleHourChange(Number(e.target.value))}
                className="flex-1 accent-blue-500 min-w-0"
                aria-label="Forecast hour"
                aria-valuetext={hourLabel}
              />
              <button
                onClick={() => handleHourChange(Math.min(effectiveMaxHours - 1, selectedHour + 24))}
                className="min-h-[36px] px-2 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer transition-colors"
                aria-label="Next day"
              >+24h</button>
              <button
                onClick={() => handleHourChange(Math.min(effectiveMaxHours - 1, selectedHour + 1))}
                className="min-h-[36px] px-2 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer transition-colors"
                aria-label="Next hour"
              >+1h</button>
              <button
                onClick={jumpToNow}
                className="min-h-[36px] px-2 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer transition-colors"
                aria-label="Jump to current hour"
              >Now</button>
            </div>
          </div>
        )}

        <div className="p-3">
          <div className="flex items-center gap-0.5 mb-3 border-b border-gray-800 pb-1.5">
            <button
              onClick={() => setActiveTab('models')}
              className={`px-3 py-1 rounded text-xs font-medium transition-all duration-200 cursor-pointer ${
                activeTab === 'models'
                  ? 'text-white bg-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900/50'
              }`}
            >
              Modelos
            </button>
            <button
              onClick={() => setActiveTab('stations')}
              className={`px-3 py-1 rounded text-xs font-medium transition-all duration-200 cursor-pointer ${
                activeTab === 'stations'
                  ? 'text-white bg-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900/50'
              }`}
            >
              Estaciones
            </button>
          </div>

          {activeTab === 'stations' ? (
            <StationDashboard position={position} placeName={cityName} />
          ) : (
            <div ref={swipeRef}>
              {isLoading && (
                <div className="space-y-4">
                  <DailySummarySkeleton />
                  <InsightsSkeleton />
                  <ChartSkeleton />
                </div>
              )}

              {error && (
                <div className="text-red-400 text-center py-8 text-sm">
                  {STRINGS[locale].errorForecast}
                </div>
              )}

              {viewData && (
                <>
                  <DailySummary
                    models={displayModels}
                    activeModelIds={displayActiveModelIds}
                    times={viewData.time}
                    series={viewData.series}
                    selectedHour={selectedHour}
                    onSelectHour={handleHourChange}
                    maxHours={effectiveMaxHours}
                    showMarine={marine}
                    showBasic={showBasic}
                  />
                  <ModelSelector
                    models={displayModels}
                    selected={selectedModels}
                    onChange={handleModelChange}
                  />
                  <InsightsTable
                    models={displayModels}
                    activeModelIds={displayActiveModelIds}
                    times={viewData.time}
                    series={viewData.series}
                    bucket={bucket}
                    onBucketChange={handleBucketChange}
                    selectedHour={selectedHour}
                    onSelectHour={handleHourChange}
                    maxHours={effectiveMaxHours}
                    utcOffsetSeconds={viewData.utcOffsetSeconds}
                    showMarine={marine}
                    showBasic={showBasic}
                  />
                  <ModelComparisonChart
                    models={displayModels}
                    activeModelIds={displayActiveModelIds}
                    metric={selectedMetric}
                    times={viewData.time}
                    series={viewData.series}
                    onHourHover={handleHourChange}
                    hoveredHour={selectedHour}
                    maxHours={effectiveMaxHours}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="hidden md:flex md:mt-auto px-3 py-0.5 bg-gray-900/50 border-t border-gray-800/50 text-[9px] text-gray-700 gap-3 shrink-0">
        <span>← → {STRINGS[locale].footerHours}</span>
        <span>/ {STRINGS[locale].footerSearch}</span>
        <span>m {STRINGS[locale].footerMap}</span>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[2000] bg-gray-800/95 border border-gray-700 text-white text-xs px-3 py-1.5 rounded-md shadow-lg animate-fadeIn" style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import CitySearch from '@/components/CitySearch'
import MetricPills from '@/components/MetricPills'
import ModelPills from '@/components/ModelPills'
import TimeRangeSelector from '@/components/TimeRangeSelector'
import ModelComparisonChart from '@/components/ModelComparisonChart'
import DailySummary from '@/components/DailySummary'
import InsightsTable, { type BucketHours } from '@/components/InsightsTable'
import SavedLocations from '@/components/SavedLocations'
import ColorLegend from '@/components/ColorLegend'
import RefreshButton from '@/components/RefreshButton'
import { MODELS, METRICS, type MetricId } from '@/lib/models'
import { fetchForecast, type ForecastResult } from '@/lib/openMeteo'
import { useUrlState } from '@/lib/useUrlState'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS, type Locale } from '@/lib/i18n'

function sliceForecast(data: ForecastResult, startIndex: number): ForecastResult {
  const time = data.time.slice(startIndex)
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
  return { time, series, utcOffsetSeconds: data.utcOffsetSeconds }
}

const MapPicker = dynamic(() => import('@/components/MapPicker'), { ssr: false })

const DEFAULT_POS: [number, number] = [41.4500, 2.2475]
const DEFAULT_CITY = 'Badalona'
const DEFAULT_METRIC: MetricId = 'temperature'
const DEFAULT_MODELS = MODELS.map(m => m.id)
const DEFAULT_RANGE = 168
const OPEN_METEO_MAX_DAYS = 16

export default function HomeContent() {
  const [defaults] = useState(() => ({
    lat: DEFAULT_POS[0],
    lon: DEFAULT_POS[1],
    metric: DEFAULT_METRIC,
    models: DEFAULT_MODELS,
    hour: 0,
    range: DEFAULT_RANGE,
    showMap: typeof window === 'undefined' ? true : !window.matchMedia('(max-width: 767px)').matches,
    showRadar: false,
    bucket: 4,
    locale: '',
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
  const queryClient = useQueryClient()

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

  useEffect(() => {
    if (urlState.locale && urlState.locale !== locale) {
      toggleLocale()
    }
  }, [])

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

  const { data: refreshStatus } = useQuery<{ lastRefreshedAt: number | null }>({
    queryKey: ['refresh-status'],
    queryFn: async () => {
      const res = await fetch('/api/refresh')
      if (!res.ok) throw new Error('refresh status')
      return res.json()
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  const autoRefreshDone = useRef(false)
  useEffect(() => {
    if (autoRefreshDone.current) return
    autoRefreshDone.current = true
    fetch('/api/refresh', { method: 'POST' })
      .then(res => res.json())
      .then(result => {
        queryClient.invalidateQueries({ queryKey: ['refresh-status'] })
        if (result?.skipped === false) {
          queryClient.invalidateQueries({ queryKey: ['forecast'] })
        }
      })
      .catch(() => {})
  }, [queryClient])

  const forecastDays = Math.min(Math.ceil(selectedRange / 24), OPEN_METEO_MAX_DAYS)

  const { data, isLoading, error } = useQuery({
    queryKey: ['forecast', position[0], position[1], forecastDays, refreshStatus?.lastRefreshedAt ?? 0],
    queryFn: ({ signal }) => fetchForecast(position[0], position[1], MODELS, METRICS, forecastDays, signal),
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
      setToast('Save failed')
    },
  })

  const handleCitySelect = useCallback((name: string, lat: number, lon: number) => {
    setCityName(name)
    setPosition([lat, lon])
    setRecenterToken(t => t + 1)
    updateUrl({ lat, lon })
  }, [updateUrl])

  const handlePositionChange = useCallback((pos: [number, number]) => {
    setPosition(pos)
    setCityName(`${pos[0].toFixed(2)}, ${pos[1].toFixed(2)}`)
    updateUrl({ lat: pos[0], lon: pos[1] })
  }, [updateUrl])

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

  const handleBucketChange = useCallback((b: BucketHours) => {
    updateUrl({ bucket: b })
  }, [updateUrl])

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude
        const lon = pos.coords.longitude
        setPosition([lat, lon])
        setCityName(`${lat.toFixed(2)}, ${lon.toFixed(2)}`)
        setRecenterToken(t => t + 1)
        updateUrl({ lat, lon })
        setGeoLoading(false)
      },
      () => setGeoLoading(false),
      { enableHighAccuracy: false, timeout: 5000 }
    )
  }, [updateUrl])

  const legendMetric: Exclude<MetricId, 'all'> = selectedMetric === 'all' ? 'temperature' : selectedMetric

  const maxModelHours = useMemo(() => {
    if (selectedModels.length === 0) return 336
    return Math.max(...selectedModels.map(id => MODELS.find(m => m.id === id)?.maxHours ?? 168))
  }, [selectedModels])

  // Skip hourly entries before the current local hour (rounded down). The
  // forecast always starts at 00:00 of today in the location's local time,
  // so at 15:54 we drop indices 0..14 and start at 15.
  const startIndex = useMemo(() => {
    if (!data?.time?.length) return 0
    const nowFloor = new Date()
    nowFloor.setMinutes(0, 0, 0)
    const nowTs = nowFloor.getTime()
    for (let i = 0; i < data.time.length; i++) {
      if (data.time[i].getTime() >= nowTs) return i
    }
    return data.time.length
  }, [data])

  const viewData = useMemo(() => {
    if (!data) return null
    if (startIndex === 0) return data
    return sliceForecast(data, startIndex)
  }, [data, startIndex])

  const hourLabel = useMemo(() => {
    if (!viewData?.time?.[selectedHour]) return `+${selectedHour}h`
    const t = viewData.time[selectedHour]
    const localeStr = locale === 'en' ? 'en-US' : 'es-ES'
    const hh = t.toLocaleTimeString(localeStr, { hour: '2-digit', minute: '2-digit', hour12: false })
    const dd = t.toLocaleDateString(localeStr, { weekday: 'short', day: '2-digit', month: '2-digit' })
    return `${dd} ${hh}`
  }, [viewData, selectedHour, locale])

  const effectiveMaxHours = Math.min(selectedRange, maxModelHours, viewData?.time.length ?? 336)

  // After trimming, hour index 0 IS the current hour by construction.
  const jumpToNow = useCallback(() => {
    handleHourChange(0)
  }, [handleHourChange])

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
        document.querySelector<HTMLInputElement>('input[placeholder="Search city..."]')?.focus()
      } else if (e.key === 'm') {
        handleMapToggle()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedHour, effectiveMaxHours, handleHourChange, handleMapToggle])

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      <header ref={mobileMenuRef} className="px-3 py-1.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-1.5">
          <h1 className="text-xs font-semibold text-gray-400 whitespace-nowrap hidden sm:block">Weather</h1>
          <div className="w-px h-4 bg-gray-800 hidden sm:block" />
          <div className="relative flex-1 sm:flex-none">
            <CitySearch onSelect={handleCitySelect} />
          </div>
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
            className={`md:hidden min-h-[36px] min-w-[36px] flex items-center justify-center transition-colors cursor-pointer ${
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
          <div className="hidden md:flex items-center gap-1.5">
            <MetricPills metrics={METRICS} selected={selectedMetric} onChange={handleMetricChange} />
            <div className="w-px h-4 bg-gray-800" />
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
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="min-h-[32px] px-2 rounded text-[11px] font-medium text-gray-500 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              Save
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
            className="md:hidden min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-400 hover:text-white cursor-pointer ml-auto"
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

        <div className="flex md:hidden mt-1.5 items-center gap-x-3 gap-y-1 flex-wrap">
          <MetricPills metrics={METRICS} selected={selectedMetric} onChange={handleMetricChange} />
          <TimeRangeSelector selected={selectedRange} onChange={handleRangeChange} maxAvailable={maxModelHours} showLabel={false} />
        </div>

        <div className="hidden md:flex items-center gap-2 mt-1">
          <ModelPills models={MODELS} selected={selectedModels} onChange={handleModelChange} />
          <div className="w-px h-3 bg-gray-800" />
          <TimeRangeSelector selected={selectedRange} onChange={handleRangeChange} maxAvailable={maxModelHours} />
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden mt-2 pt-2 border-t border-gray-800 space-y-2 animate-fadeIn">
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
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="min-h-[36px] px-3 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 disabled:opacity-50 cursor-pointer"
              >
                Save
              </button>
              <RefreshButton />
              <button
                onClick={() => { toggleLocale(); updateUrl({ locale: locale === 'en' ? 'es' : 'en' }) }}
                className="min-h-[36px] px-3 rounded text-xs font-semibold bg-gray-800 text-gray-400 border border-gray-700 cursor-pointer tracking-wider"
              >
                {locale === 'en' ? 'ES' : 'EN'}
              </button>
            </div>
            <div className="flex-wrap -mx-1 px-1">
              <ModelPills models={MODELS} selected={selectedModels} onChange={handleModelChange} />
            </div>
            <div className="text-[10px] text-gray-500 pt-1 border-t border-gray-800/50">
              {cityName} · {position[0].toFixed(2)}, {position[1].toFixed(2)}
            </div>
          </div>
        )}
      </header>

      <SavedLocations onSelect={handleCitySelect} />

      <div className="flex flex-col flex-1 overflow-y-auto">
        {showMap && (
          <div className="h-[40vh] min-h-[260px] max-h-[440px] p-1.5 border-b border-gray-800 relative shrink-0">
            <MapPicker
              position={position}
              recenterToken={recenterToken}
              onPositionChange={handlePositionChange}
              showHeatmap={showMap}
              metric={selectedMetric}
              selectedModels={selectedModels}
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
          {isLoading && (
            <div className="flex items-center justify-center h-40">
              <div className="w-5 h-5 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
              <span className="ml-2 text-gray-400 text-sm">{STRINGS[locale].loadingForecast}</span>
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
                models={MODELS}
                activeModelIds={selectedModels}
                times={viewData.time}
                series={viewData.series}
                selectedHour={selectedHour}
                onSelectHour={handleHourChange}
                maxHours={effectiveMaxHours}
              />
              <InsightsTable
                models={MODELS}
                activeModelIds={selectedModels}
                times={viewData.time}
                series={viewData.series}
                bucket={bucket}
                onBucketChange={handleBucketChange}
                selectedHour={selectedHour}
                onSelectHour={handleHourChange}
                maxHours={effectiveMaxHours}
              />
              <ModelComparisonChart
                models={MODELS}
                activeModelIds={selectedModels}
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
      </div>

      <div className="hidden md:flex px-3 py-0.5 bg-gray-900/50 border-t border-gray-800/50 text-[9px] text-gray-700 gap-3 shrink-0">
        <span>← → {STRINGS[locale].footerHours}</span>
        <span>/ {STRINGS[locale].footerSearch}</span>
        <span>m {STRINGS[locale].footerMap}</span>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[2000] bg-gray-800/95 border border-gray-700 text-white text-xs px-3 py-1.5 rounded-md shadow-lg animate-fadeIn">
          {toast}
        </div>
      )}
    </div>
  )
}

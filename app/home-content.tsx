'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import CitySearch from '@/components/CitySearch'
import MetricPills from '@/components/MetricPills'
import ModelPills from '@/components/ModelPills'
import TimeRangeSelector from '@/components/TimeRangeSelector'
import ModelComparisonChart from '@/components/ModelComparisonChart'
import SavedLocations from '@/components/SavedLocations'
import ColorLegend from '@/components/ColorLegend'
import RefreshButton from '@/components/RefreshButton'
import { MODELS, METRICS, type MetricId } from '@/lib/models'
import { fetchForecast } from '@/lib/openMeteo'
import { useUrlState } from '@/lib/useUrlState'

const MapPicker = dynamic(() => import('@/components/MapPicker'), { ssr: false })

const DEFAULT_POS: [number, number] = [40.4168, -3.7038]
const DEFAULT_METRIC: MetricId = 'temperature'
const DEFAULT_MODELS = MODELS.map(m => m.id)
const DEFAULT_RANGE = 168

export default function HomeContent() {
  const [urlState, updateUrl] = useUrlState({
    lat: DEFAULT_POS[0],
    lon: DEFAULT_POS[1],
    metric: DEFAULT_METRIC,
    models: DEFAULT_MODELS,
    hour: 0,
    range: DEFAULT_RANGE,
    showMap: true,
  })

  const [position, setPosition] = useState<[number, number]>([urlState.lat, urlState.lon])
  const [recenterToken, setRecenterToken] = useState(0)
  const [cityName, setCityName] = useState('Madrid')
  const [geoLoading, setGeoLoading] = useState(false)
  const queryClient = useQueryClient()

  const selectedMetric = urlState.metric as MetricId
  const selectedModels = urlState.models
  const selectedHour = urlState.hour
  const selectedRange = urlState.range
  const showMap = urlState.showMap

  const metric = METRICS.find(m => m.id === selectedMetric)!

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

  const { data, isLoading, error } = useQuery({
    queryKey: ['forecast', position[0], position[1], refreshStatus?.lastRefreshedAt ?? 0],
    queryFn: ({ signal }) => fetchForecast(position[0], position[1], MODELS, METRICS, 7, signal),
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

  const hourLabel = useMemo(() => {
    if (!data?.time?.[selectedHour]) return `+${selectedHour}h`
    const t = data.time[selectedHour]
    const hh = t.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false })
    const dd = t.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' })
    return `${dd} ${hh} (+${selectedHour}h)`
  }, [data, selectedHour])

  const maxModelHours = useMemo(() => {
    if (selectedModels.length === 0) return 336
    return Math.max(...selectedModels.map(id => MODELS.find(m => m.id === id)?.maxHours ?? 168))
  }, [selectedModels])

  const effectiveMaxHours = Math.min(selectedRange, maxModelHours, 336)

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
      <header className="px-3 py-1.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-1.5">
          <h1 className="text-xs font-semibold text-gray-400 whitespace-nowrap">Weather</h1>
          <div className="w-px h-4 bg-gray-800" />
          <div className="relative">
            <CitySearch onSelect={handleCitySelect} />
          </div>
          <button
            onClick={handleGeolocate}
            disabled={geoLoading}
            className="p-1.5 text-gray-500 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
            title="Use my location"
          >
            {geoLoading ? (
              <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
          <MetricPills metrics={METRICS} selected={selectedMetric} onChange={handleMetricChange} />
          <div className="w-px h-4 bg-gray-800" />
          <button
            onClick={handleMapToggle}
            className={`px-1.5 py-1 rounded text-[10px] font-medium transition-all cursor-pointer ${
              showMap ? 'text-white' : 'text-gray-600 hover:text-gray-300'
            }`}
          >
            Map
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="px-1.5 py-1 rounded text-[10px] font-medium text-gray-500 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
          >
            Save
          </button>
          <RefreshButton />
          <span className="text-[10px] text-gray-600 ml-auto truncate max-w-[160px]">{cityName} ({position[0].toFixed(2)}, {position[1].toFixed(2)})</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <ModelPills models={MODELS} selected={selectedModels} onChange={handleModelChange} />
          <div className="w-px h-3 bg-gray-800" />
          <TimeRangeSelector selected={selectedRange} onChange={handleRangeChange} maxAvailable={maxModelHours} />
        </div>
      </header>

      <SavedLocations onSelect={handleCitySelect} />

      <div className="flex flex-col flex-1 overflow-hidden">
        {showMap && (
          <div className="h-[50%] min-h-[200px] p-1.5 border-b border-gray-800 relative">
            <MapPicker
              position={position}
              recenterToken={recenterToken}
              onPositionChange={handlePositionChange}
              showHeatmap={showMap}
              metric={selectedMetric}
              selectedModel={selectedModels.length === 1 ? selectedModels[0] : null}
              hourIndex={selectedHour}
            />
            <div className="absolute bottom-2.5 left-2.5 z-[1000] bg-gray-900/90 p-2 rounded-lg shadow-lg">
              <ColorLegend metric={legendMetric} />
            </div>
            <div className="absolute top-2.5 right-2.5 z-[1000] bg-gray-900/90 px-2 py-1 rounded text-[10px] text-gray-300 pointer-events-none">
              {(selectedModels.length === 1 ? MODELS.find(m => m.id === selectedModels[0])?.label : 'Ensemble')} — {hourLabel}
            </div>
            <div className="absolute bottom-2.5 right-2.5 left-2.5 z-[1000] bg-gray-900/80 px-3 py-1.5 rounded-lg shadow-lg pointer-events-auto md:left-auto md:w-[60%]">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleHourChange(Math.max(0, selectedHour - 1))}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer transition-colors"
                  aria-label="Previous hour"
                >−1h</button>
                <button
                  onClick={() => handleHourChange(Math.max(0, selectedHour - 24))}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer transition-colors"
                  aria-label="Previous day"
                >−24h</button>
                <input
                  type="range"
                  min={0}
                  max={effectiveMaxHours - 1}
                  value={selectedHour}
                  onChange={e => handleHourChange(Number(e.target.value))}
                  className="flex-1 accent-blue-500"
                  aria-label="Forecast hour"
                />
                <button
                  onClick={() => handleHourChange(Math.min(effectiveMaxHours - 1, selectedHour + 24))}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer transition-colors"
                  aria-label="Next day"
                >+24h</button>
                <button
                  onClick={() => handleHourChange(Math.min(effectiveMaxHours - 1, selectedHour + 1))}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer transition-colors"
                  aria-label="Next hour"
                >+1h</button>
                <button
                  onClick={() => handleHourChange(0)}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer transition-colors"
                  aria-label="Reset to now"
                >Now</button>
              </div>
            </div>
          </div>
        )}

        <div className={`${showMap ? 'h-[50%]' : 'h-full'} overflow-auto p-3`}>
          {isLoading && (
            <div className="flex items-center justify-center h-40">
              <div className="w-5 h-5 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
              <span className="ml-2 text-gray-400 text-sm">Loading forecast...</span>
            </div>
          )}

          {error && (
            <div className="text-red-400 text-center py-8 text-sm">
              Error loading forecast. Please try again.
            </div>
          )}

          {data && (
            <ModelComparisonChart
              models={MODELS}
              activeModelIds={selectedModels}
              metric={selectedMetric}
              times={data.time}
              series={data.series}
              onHourHover={handleHourChange}
              hoveredHour={selectedHour}
              maxHours={effectiveMaxHours}
            />
          )}
        </div>
      </div>

      <div className="px-3 py-0.5 bg-gray-900/50 border-t border-gray-800/50 text-[9px] text-gray-700 flex gap-3 shrink-0">
        <span>← → hours</span>
        <span>/ search</span>
        <span>m map</span>
      </div>
    </div>
  )
}

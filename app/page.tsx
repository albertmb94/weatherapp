'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import CitySearch from '@/components/CitySearch'
import MetricDropdown from '@/components/MetricDropdown'
import ModelSelector from '@/components/ModelSelector'
import ModelComparisonChart from '@/components/ModelComparisonChart'
import SavedLocations from '@/components/SavedLocations'
import ColorLegend from '@/components/ColorLegend'
import RefreshButton from '@/components/RefreshButton'
import { MODELS, METRICS, type MetricId } from '@/lib/models'
import { fetchForecast } from '@/lib/openMeteo'

const MapPicker = dynamic(() => import('@/components/MapPicker'), { ssr: false })

const DEFAULT_POS: [number, number] = [40.4168, -3.7038]
const MAX_HOURS = 168

export default function Home() {
  const [position, setPosition] = useState<[number, number]>(DEFAULT_POS)
  const [recenterToken, setRecenterToken] = useState(0)
  const [selectedMetric, setSelectedMetric] = useState<MetricId>('temperature')
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [cityName, setCityName] = useState('Madrid')
  const [showMap, setShowMap] = useState(true)
  const [selectedHour, setSelectedHour] = useState<number>(0)
  const queryClient = useQueryClient()

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

  // On entry: ask the server to refresh if the stored snapshot is older
  // than the cooldown (4h). The endpoint returns `skipped:true` otherwise,
  // so this is cheap when data is recent.
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
      .catch(() => {
        // Non-fatal: the page still works against live Open-Meteo data.
      })
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
  }, [])

  const handlePositionChange = useCallback((pos: [number, number]) => {
    setPosition(pos)
    setCityName(`${pos[0].toFixed(2)}, ${pos[1].toFixed(2)}`)
    // No recenter: keep the user's current pan/zoom intact.
  }, [])

  const legendMetric: Exclude<MetricId, 'all'> = selectedMetric === 'all' ? 'temperature' : selectedMetric

  const hourLabel = useMemo(() => {
    if (!data?.time?.[selectedHour]) return `+${selectedHour}h`
    const t = data.time[selectedHour]
    const hh = t.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
    const dd = t.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
    return `${dd} ${hh} UTC (+${selectedHour}h)`
  }, [data, selectedHour])

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      <header className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
        <h1 className="text-sm font-bold whitespace-nowrap">Weather Models</h1>
        <CitySearch onSelect={handleCitySelect} />
        <MetricDropdown metrics={METRICS} selected={selectedMetric} onChange={setSelectedMetric} />
        <ModelSelector models={MODELS} selected={selectedModel} onChange={setSelectedModel} />
        <button
          onClick={() => setShowMap(v => !v)}
          className={`px-2.5 py-1.5 rounded text-xs cursor-pointer border transition-colors ${
            showMap ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'
          }`}
        >
          {showMap ? 'Hide Map' : 'Show Map'}
        </button>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="px-2.5 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 rounded text-xs text-white cursor-pointer disabled:cursor-not-allowed"
        >
          Save
        </button>
        <RefreshButton />
        <span className="text-[10px] text-gray-500 ml-auto truncate max-w-[200px]">{cityName} ({position[0].toFixed(2)}, {position[1].toFixed(2)})</span>
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
              selectedModel={selectedModel}
              hourIndex={selectedHour}
            />
            <div className="absolute bottom-2.5 left-2.5 z-[1000] bg-gray-900/90 p-2 rounded-lg shadow-lg">
              <ColorLegend metric={legendMetric} />
            </div>
            <div className="absolute top-2.5 right-2.5 z-[1000] bg-gray-900/90 px-2 py-1 rounded text-[10px] text-gray-300 pointer-events-none">
              {(selectedModel ? MODELS.find(m => m.id === selectedModel)?.label : 'Weighted avg')} — {hourLabel}
            </div>
            <div className="absolute bottom-2.5 right-2.5 left-2.5 z-[1000] bg-gray-900/80 px-3 py-1.5 rounded-lg shadow-lg pointer-events-auto md:left-auto md:w-[60%]">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedHour(h => Math.max(0, h - 1))}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer"
                  aria-label="Previous hour"
                >−1h</button>
                <button
                  onClick={() => setSelectedHour(h => Math.max(0, h - 24))}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer"
                  aria-label="Previous day"
                >−24h</button>
                <input
                  type="range"
                  min={0}
                  max={MAX_HOURS - 1}
                  value={selectedHour}
                  onChange={e => setSelectedHour(Number(e.target.value))}
                  className="flex-1 accent-blue-500"
                  aria-label="Forecast hour"
                />
                <button
                  onClick={() => setSelectedHour(h => Math.min(MAX_HOURS - 1, h + 24))}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer"
                  aria-label="Next day"
                >+24h</button>
                <button
                  onClick={() => setSelectedHour(h => Math.min(MAX_HOURS - 1, h + 1))}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer"
                  aria-label="Next hour"
                >+1h</button>
                <button
                  onClick={() => setSelectedHour(0)}
                  className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-xs cursor-pointer"
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
              metric={selectedMetric}
              times={data.time}
              series={data.series}
              onHourHover={setSelectedHour}
              hoveredHour={selectedHour}
            />
          )}
        </div>
      </div>
    </div>
  )
}

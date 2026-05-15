'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MetricId } from '@/lib/models'
import { getColor } from '@/lib/colorScales'
import { fetchHeatmapGrid } from '@/lib/openMeteo'
import {
  HEATMAP_ROWS,
  HEATMAP_COLS,
  HEATMAP_DEBOUNCE_MS,
  HEATMAP_FILL_OPACITY,
  HEATMAP_FORECAST_DAYS,
} from '@/lib/heatmapConfig'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

interface MapPickerProps {
  position: [number, number]
  recenterToken: number
  onPositionChange: (pos: [number, number]) => void
  showHeatmap: boolean
  metric: MetricId
  selectedModel: string | null
  hourIndex: number
}

interface GridCell {
  lat: number
  lng: number
}

function MapRecenter({ center, token }: { center: [number, number]; token: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, map.getZoom())
  }, [token, center, map])
  return null
}

function MapClickHandler({ onPositionChange }: { onPositionChange: (pos: [number, number]) => void }) {
  useMapEvents({
    click(e) {
      onPositionChange([e.latlng.lat, e.latlng.lng])
    },
  })
  return null
}

function MapReady({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap()
  useEffect(() => {
    onReady(map)
  }, [map, onReady])
  return null
}

function buildGrid(bounds: L.LatLngBounds, rows: number, cols: number): GridCell[] {
  const minLat = bounds.getSouth()
  const maxLat = bounds.getNorth()
  const minLng = bounds.getWest()
  const maxLng = bounds.getEast()
  const stepLat = (maxLat - minLat) / rows
  const stepLng = (maxLng - minLng) / cols
  const grid: GridCell[] = []
  for (let r = 0; r < rows; r++) {
    const lat = minLat + stepLat * (r + 0.5)
    for (let c = 0; c < cols; c++) {
      const lng = minLng + stepLng * (c + 0.5)
      grid.push({ lat, lng })
    }
  }
  return grid
}

function roundBounds(bounds: L.LatLngBounds, precision = 1): string {
  const f = (n: number) => n.toFixed(precision)
  return `${f(bounds.getSouth())},${f(bounds.getWest())},${f(bounds.getNorth())},${f(bounds.getEast())}`
}

export default function MapPicker({
  position,
  recenterToken,
  onPositionChange,
  showHeatmap,
  metric,
  selectedModel,
  hourIndex,
}: MapPickerProps) {
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null)
  const [boundsTick, setBoundsTick] = useState(0)
  const [gridSeries, setGridSeries] = useState<(number | null)[][]>([])
  const [gridCells, setGridCells] = useState<GridCell[]>([])
  const [loadingHeatmap, setLoadingHeatmap] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFetchKey = useRef<string>('')
  const overlayLayer = useRef<L.LayerGroup | null>(null)

  const effectiveMetric: Exclude<MetricId, 'all'> = metric === 'all' ? 'temperature' : metric

  useEffect(() => {
    if (!mapInstance) return
    const onMoveOrZoom = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        setBoundsTick(t => t + 1)
      }, HEATMAP_DEBOUNCE_MS)
    }
    mapInstance.on('moveend', onMoveOrZoom)
    mapInstance.on('zoomend', onMoveOrZoom)
    return () => {
      mapInstance.off('moveend', onMoveOrZoom)
      mapInstance.off('zoomend', onMoveOrZoom)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [mapInstance])

  useEffect(() => {
    if (!showHeatmap || !mapInstance) return

    const bounds = mapInstance.getBounds()
    const key = `${roundBounds(bounds)}|${effectiveMetric}|${selectedModel ?? 'ALL'}`
    if (key === lastFetchKey.current) return
    lastFetchKey.current = key

    const cells = buildGrid(bounds, HEATMAP_ROWS, HEATMAP_COLS)
    setGridCells(cells)

    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoadingHeatmap(true)
    setErrorMsg(null)

    fetchHeatmapGrid(cells, selectedModel, effectiveMetric, HEATMAP_FORECAST_DAYS, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        setGridSeries(result.series)
        setLoadingHeatmap(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setLoadingHeatmap(false)
        const msg = err instanceof Error ? err.message : 'Failed to load heatmap'
        setErrorMsg(msg)
        setGridSeries([])
      })
  }, [showHeatmap, mapInstance, boundsTick, effectiveMetric, selectedModel])

  useEffect(() => {
    if (!mapInstance) return

    if (!overlayLayer.current) {
      overlayLayer.current = L.layerGroup()
      overlayLayer.current.addTo(mapInstance)
    }
    const layer = overlayLayer.current
    layer.clearLayers()

    if (!showHeatmap || gridCells.length === 0 || gridSeries.length === 0) return

    const bounds = mapInstance.getBounds()
    const stepLat = (bounds.getNorth() - bounds.getSouth()) / HEATMAP_ROWS
    const stepLng = (bounds.getEast() - bounds.getWest()) / HEATMAP_COLS
    const halfLat = stepLat / 2
    const halfLng = stepLng / 2

    for (let i = 0; i < gridCells.length; i++) {
      const cell = gridCells[i]
      const series = gridSeries[i]
      const value = series?.[hourIndex] ?? null
      const color = getColor(effectiveMetric, value)
      L.rectangle(
        [
          [cell.lat - halfLat, cell.lng - halfLng],
          [cell.lat + halfLat, cell.lng + halfLng],
        ],
        {
          color: 'transparent',
          fillColor: color,
          fillOpacity: value !== null ? HEATMAP_FILL_OPACITY : 0,
          weight: 0,
          interactive: false,
        }
      ).addTo(layer)
    }
  }, [mapInstance, showHeatmap, gridCells, gridSeries, hourIndex, effectiveMetric])

  useEffect(() => {
    if (!showHeatmap && overlayLayer.current) {
      overlayLayer.current.clearLayers()
    }
  }, [showHeatmap])

  const handleMapReady = useCallback((map: L.Map) => {
    setMapInstance(map)
  }, [])

  const statusLine = useMemo(() => {
    if (!showHeatmap) return null
    if (loadingHeatmap) return 'Loading heatmap…'
    if (errorMsg) return `Heatmap error: ${errorMsg}`
    if (gridSeries.length === 0) return 'No heatmap data'
    return null
  }, [showHeatmap, loadingHeatmap, errorMsg, gridSeries.length])

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={position}
        zoom={6}
        className="w-full h-full rounded-lg transition-all duration-300"
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <Marker position={position} />
        <MapClickHandler onPositionChange={onPositionChange} />
        <MapRecenter center={position} token={recenterToken} />
        <MapReady onReady={handleMapReady} />
      </MapContainer>
      {statusLine && (
        <div className="absolute top-2 left-2 z-[1000] bg-gray-900/80 px-2 py-1 rounded text-xs text-gray-300 pointer-events-none">
          {statusLine}
        </div>
      )}
    </div>
  )
}

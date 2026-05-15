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
  HEATMAP_FORECAST_DAYS,
} from '@/lib/heatmapConfig'
import RainRadarOverlay from './RainRadarOverlay'
import type { RainviewerFrame } from '@/lib/rainViewer'

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
  selectedModels: string[]
  hourIndex: number
  showRadar: boolean
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

function bilinearInterpolate(
  lat: number,
  lng: number,
  gridCells: GridCell[],
  values: number[],
  rows: number,
  cols: number
): number | null {
  const minLat = gridCells[0]?.lat ?? 0
  const maxLat = gridCells[(rows - 1) * cols]?.lat ?? 0
  const minLng = gridCells[0]?.lng ?? 0
  const maxLng = gridCells[cols - 1]?.lng ?? 0

  const stepLat = (maxLat - minLat) / (rows - 1 || 1)
  const stepLng = (maxLng - minLng) / (cols - 1 || 1)

  const fi = (lat - minLat) / stepLat
  const fj = (lng - minLng) / stepLng

  const i0 = Math.max(0, Math.min(rows - 2, Math.floor(fi)))
  const j0 = Math.max(0, Math.min(cols - 2, Math.floor(fj)))
  const i1 = i0 + 1
  const j1 = j0 + 1

  const ti = (fi - i0) || 0
  const tj = (fj - j0) || 0

  const v00 = values[i0 * cols + j0]
  const v01 = values[i0 * cols + j1]
  const v10 = values[i1 * cols + j0]
  const v11 = values[i1 * cols + j1]

  if (v00 === null || v01 === null || v10 === null || v11 === null) return null

  const v0 = v00 * (1 - tj) + v01 * tj
  const v1 = v10 * (1 - tj) + v11 * tj
  return v0 * (1 - ti) + v1 * ti
}

function parseColor(color: string): [number, number, number] {
  const match = color.match(/rgb\((\d+),(\d+),(\d+)\)/)
  if (!match) return [42, 42, 42]
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]
}

export default function MapPicker({
  position,
  recenterToken,
  onPositionChange,
  showHeatmap,
  metric,
  selectedModels,
  hourIndex,
  showRadar,
}: MapPickerProps) {
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null)
  const [boundsTick, setBoundsTick] = useState(0)
  const [gridSeries, setGridSeries] = useState<(number | null)[][]>([])
  const [gridCells, setGridCells] = useState<GridCell[]>([])
  const [loadingHeatmap, setLoadingHeatmap] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [radarFrames, setRadarFrames] = useState<RainviewerFrame[]>([])
  const [radarFrameIndex, setRadarFrameIndex] = useState(0)
  const [radarPlaying, setRadarPlaying] = useState(true)

  const handleRadarFramesLoaded = useCallback((count: number, frames: RainviewerFrame[]) => {
    setRadarFrames(frames)
    setRadarFrameIndex(prev => Math.min(prev, Math.max(0, count - 1)))
  }, [])
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFetchKey = useRef<string>('')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderFrameRef = useRef<number | null>(null)

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
    const modelsKey = selectedModels.length > 0 ? selectedModels.slice().sort().join(',') : 'ALL'
    const key = `${roundBounds(bounds)}|${effectiveMetric}|${modelsKey}`
    if (key === lastFetchKey.current) return
    lastFetchKey.current = key

    const cells = buildGrid(bounds, HEATMAP_ROWS, HEATMAP_COLS)
    setGridCells(cells)

    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoadingHeatmap(true)
    setErrorMsg(null)

    fetchHeatmapGrid(cells, selectedModels, effectiveMetric, HEATMAP_FORECAST_DAYS, controller.signal)
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
  }, [showHeatmap, mapInstance, boundsTick, effectiveMetric, selectedModels])

  const renderCanvas = useCallback(() => {
    if (!mapInstance || !canvasRef.current || gridCells.length === 0 || gridSeries.length === 0) return

    const canvas = canvasRef.current
    const container = mapInstance.getContainer()
    const width = container.clientWidth
    const height = container.clientHeight

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, width, height)

    const values = gridSeries.map(series => series?.[hourIndex] ?? null)
    const allNull = values.every(v => v === null)
    if (allNull) return

    const step = 4
    const imageData = ctx.createImageData(width, height)
    const data = imageData.data

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const latLng = mapInstance.containerPointToLatLng(L.point(x, y))
        const value = bilinearInterpolate(latLng.lat, latLng.lng, gridCells, values as number[], HEATMAP_ROWS, HEATMAP_COLS)
        const color = getColor(effectiveMetric, value)
        const [r, g, b] = parseColor(color)

        for (let dy = 0; dy < step && y + dy < height; dy++) {
          for (let dx = 0; dx < step && x + dx < width; dx++) {
            const idx = ((y + dy) * width + (x + dx)) * 4
            data[idx] = r
            data[idx + 1] = g
            data[idx + 2] = b
            data[idx + 3] = value !== null ? 140 : 0
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0)
  }, [mapInstance, gridCells, gridSeries, hourIndex, effectiveMetric])

  useEffect(() => {
    if (!showHeatmap || !mapInstance) return
    if (renderFrameRef.current) cancelAnimationFrame(renderFrameRef.current)
    renderFrameRef.current = requestAnimationFrame(() => {
      renderCanvas()
      renderFrameRef.current = null
    })
    return () => {
      if (renderFrameRef.current) cancelAnimationFrame(renderFrameRef.current)
    }
  }, [showHeatmap, mapInstance, gridCells, gridSeries, hourIndex, effectiveMetric, renderCanvas])

  useEffect(() => {
    if (!mapInstance) return
    const onMove = () => {
      if (renderFrameRef.current) cancelAnimationFrame(renderFrameRef.current)
      renderFrameRef.current = requestAnimationFrame(() => {
        renderCanvas()
        renderFrameRef.current = null
      })
    }
    mapInstance.on('move', onMove)
    return () => {
      mapInstance.off('move', onMove)
    }
  }, [mapInstance, renderCanvas])

  useEffect(() => {
    if (!showHeatmap && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
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
        <RainRadarOverlay
          enabled={showRadar}
          playing={radarPlaying}
          frameIndex={radarFrameIndex}
          onFrameChange={setRadarFrameIndex}
          onFramesLoaded={handleRadarFramesLoaded}
        />
      </MapContainer>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 400 }}
      />
      {statusLine && (
        <div className="absolute top-2 left-2 z-[1000] bg-gray-900/80 px-2 py-1 rounded text-xs text-gray-300 pointer-events-none">
          {statusLine}
        </div>
      )}
      {showRadar && radarFrames.length > 0 && (
        <div className="absolute top-2 right-2 z-[1000] bg-gray-900/85 px-2 py-1 rounded-lg shadow-lg flex items-center gap-2 pointer-events-auto">
          <button
            onClick={() => setRadarPlaying(p => !p)}
            className="text-gray-200 hover:text-white cursor-pointer text-xs w-4 flex items-center justify-center"
            aria-label={radarPlaying ? 'Pause radar' : 'Play radar'}
          >
            {radarPlaying ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={radarFrames.length - 1}
            value={radarFrameIndex}
            onChange={e => setRadarFrameIndex(Number(e.target.value))}
            className="w-32 accent-sky-400"
            aria-label="Radar frame"
          />
          <span className="text-[10px] text-gray-400 font-mono w-12 text-right">
            {radarFrames[radarFrameIndex] ? new Date(radarFrames[radarFrameIndex].time * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—'}
          </span>
        </div>
      )}
    </div>
  )
}

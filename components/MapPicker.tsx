'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MetricId } from '@/lib/models'
import { getColor } from '@/lib/colorScales'
import { fetchHeatmapGrid } from '@/lib/openMeteo'
import { useLocale } from '@/lib/LocaleContext'
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
  nowOffset: number
  showRadar: boolean
}

interface GridCell {
  lat: number
  lng: number
}

function MapRecenter({ center, token }: { center: [number, number]; token: number }) {
  const map = useMap()
  // B7: depend only on `token`. Reading `center` from a ref avoids the
  // effect re-firing on every `setPosition` call (which happens on every
  // map click), so the user's pan/zoom is no longer yanked back to
  // the position they just clicked.
  const centerRef = useRef(center)
  useEffect(() => {
    centerRef.current = center
  }, [center])
  useEffect(() => {
    map.setView(centerRef.current, map.getZoom())
  }, [token, map])
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
  nowOffset,
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
  const [radarError, setRadarError] = useState<string | null>(null)
  const { locale } = useLocale()

  const handleRadarFramesLoaded = useCallback((count: number, frames: RainviewerFrame[]) => {
    setRadarFrames(frames)
    setRadarError(null)
    setRadarFrameIndex(prev => {
      if (count === 0) return 0
      const lastPastIdx = frames.findIndex(f => f.time > Date.now() / 1000) - 1
      const defaultIdx = lastPastIdx >= 0 ? lastPastIdx : count - 1
      return prev === 0 ? defaultIdx : Math.min(prev, count - 1)
    })
  }, [])

  const handleRadarError = useCallback((msg: string) => setRadarError(msg), [])
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

    // PC: the map container can change size (window resize, sidebar
    // collapse, devtools open/close) and the heatmap canvas needs to
    // re-render against the new dimensions. The 'resize' event on the
    // map instance is fired by Leaflet when the container size changes;
    // ResizeObserver catches container size changes that don't go
    // through Leaflet (e.g. flexbox reflow after tab switch).
    mapInstance.on('resize', onMoveOrZoom)
    const container = mapInstance.getContainer()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => onMoveOrZoom()) : null
    if (ro) ro.observe(container)

    return () => {
      mapInstance.off('moveend', onMoveOrZoom)
      mapInstance.off('zoomend', onMoveOrZoom)
      mapInstance.off('resize', onMoveOrZoom)
      if (ro) ro.disconnect()
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
    const dpr = window.devicePixelRatio || 1
    const width = container.clientWidth
    const height = container.clientHeight

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cw = width * dpr
    const ch = height * dpr
    ctx.clearRect(0, 0, cw, ch)

    const realIdx = hourIndex + nowOffset
    const values = gridSeries.map(series => series?.[realIdx] ?? null)
    const allNull = values.every(v => v === null)
    if (allNull) return

    const step = Math.max(1, Math.round(4 * dpr))
    const imageData = ctx.createImageData(cw, ch)
    const data = imageData.data

    for (let py = 0; py < ch; py += step) {
      for (let px = 0; px < cw; px += step) {
        const containerX = px / dpr
        const containerY = py / dpr
        const latLng = mapInstance.containerPointToLatLng(L.point(containerX, containerY))
        const value = bilinearInterpolate(latLng.lat, latLng.lng, gridCells, values as number[], HEATMAP_ROWS, HEATMAP_COLS)
        const color = getColor(effectiveMetric, value)
        const [r, g, b] = parseColor(color)

        for (let dy = 0; dy < step && py + dy < ch; dy++) {
          for (let dx = 0; dx < step && px + dx < cw; dx++) {
            const idx = ((py + dy) * cw + (px + dx)) * 4
            data[idx] = r
            data[idx + 1] = g
            data[idx + 2] = b
            data[idx + 3] = value !== null ? 140 : 0
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0)
  }, [mapInstance, gridCells, gridSeries, hourIndex, nowOffset, effectiveMetric])

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
    let last = 0
    const onMove = () => {
      const now = Date.now()
      if (now - last < 50) return
      last = now
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

  // Reparent the canvas into Leaflet's own container (the
  // `.leaflet-container` div) so it sits in Leaflet's own stacking
  // context. The previous attempt put it into the `overlayPane` but
  // that pane has no explicit position/dimensions of its own, so the
  // canvas inherited zero size and vanished. The `.leaflet-container`
  // has position:relative and the map's full pixel size, so an
  // absolutely-positioned canvas inside it fills the map.
  useEffect(() => {
    if (!mapInstance || !canvasRef.current) return
    const container = mapInstance.getContainer()
    if (canvasRef.current.parentElement !== container) {
      container.appendChild(canvasRef.current)
      // After re-parenting, the canvas style left over from the
      // sibling layout (top:0 left:0 width:100% height:100%) is
      // exactly what we want inside the container, so we just
      // re-assert it and trigger a redraw.
      const c = canvasRef.current
      c.style.position = 'absolute'
      c.style.top = '0'
      c.style.left = '0'
      c.style.width = '100%'
      c.style.height = '100%'
      c.style.zIndex = '450'
      c.style.pointerEvents = 'none'
      mapInstance.invalidateSize()
    }
  }, [mapInstance])

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
        <Marker
          position={position}
          icon={L.divIcon({
            className: 'user-marker',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
            html: '<div class="user-marker-dot"></div>',
          })}
        />
        <MapClickHandler onPositionChange={onPositionChange} />
        <MapRecenter center={position} token={recenterToken} />
        <MapReady onReady={handleMapReady} />
        <RainRadarOverlay
          enabled={showRadar}
          playing={radarPlaying}
          frameIndex={radarFrameIndex}
          onFrameChange={setRadarFrameIndex}
          onFramesLoaded={handleRadarFramesLoaded}
          onError={handleRadarError}
        />
      </MapContainer>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full rounded-lg pointer-events-none"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        aria-hidden="true"
      />
      <div className="sr-only" role="status" aria-live="polite">
        {statusLine || (showHeatmap ? 'Heatmap visible on map' : 'Map without heatmap overlay')}
      </div>
      {statusLine && (
        <div className="absolute top-2 left-2 z-[1000] bg-gray-900/80 px-2 py-1 rounded text-xs text-gray-300 pointer-events-none">
          {statusLine}
        </div>
      )}
      {showRadar && (
        <div className="absolute top-2 right-2 z-[1000] flex flex-col items-end gap-1 pointer-events-none">
          {radarFrames.length > 0 && (
            <div className="bg-gray-900/85 px-2 py-1 rounded-lg shadow-lg flex items-center gap-2 pointer-events-auto">
              <button
                onClick={() => setRadarPlaying(p => !p)}
                className="text-gray-200 hover:text-white cursor-pointer text-sm leading-none min-w-[20px] min-h-[24px] flex items-center justify-center"
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
                className="w-24 sm:w-32 accent-sky-400"
                aria-label="Radar frame"
              />
              <span className="text-[10px] text-gray-300 font-mono w-12 text-right">
                {radarFrames[radarFrameIndex] ? new Date(radarFrames[radarFrameIndex].time * 1000).toLocaleTimeString(locale === 'en' ? 'en-US' : 'es-ES', { hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
            </div>
          )}
          {radarFrames.length > 0 && (
            <div className="bg-gray-900/85 px-2 py-1 rounded-lg shadow-lg text-[10px] text-gray-400 pointer-events-none flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span>Light</span>
              <span className="w-2 h-2 rounded-full bg-yellow-400" />
              <span>Mod</span>
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              <span>Heavy</span>
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span>Extreme</span>
            </div>
          )}
          {radarFrames.length === 0 && !radarError && (
            <div className="bg-gray-900/85 px-2 py-1 rounded-lg shadow-lg text-[10px] text-gray-300 pointer-events-none">
              Loading radar…
            </div>
          )}
          {radarError && (
            <div className="bg-red-900/85 px-2 py-1 rounded-lg shadow-lg text-[10px] text-red-100 pointer-events-none">
              Radar: {radarError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

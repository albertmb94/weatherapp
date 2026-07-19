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
  /** Index into the heatmap-grid series to render (0-based hour slot). */
  hourIndex: number
  /** Latest available timestamp in the grid series (Unix ms). The heatmap
   *  series is 7 days long and shares no past_days with the main forecast
   *  series, so we can no longer reuse the absolute `startIndex` from the
   *  main response — alignment must happen by timestamp. */
  mapTimes?: Date[]
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
  mapTimes,
  showRadar,
}: MapPickerProps) {
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null)
  const [boundsTick, setBoundsTick] = useState(0)
  const [gridSeries, setGridSeries] = useState<(number | null)[][]>([])
  const [gridCells, setGridCells] = useState<GridCell[]>([])
  const [loadingHeatmap, setLoadingHeatmap] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [modelCapInfo, setModelCapInfo] = useState<{ requested: number; used: number } | null>(null)
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

  const effectiveMetric = metric

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
        setModelCapInfo(
          result.modelCapExceeded
            ? { requested: result.requestedModels, used: result.usedModels }
            : null
        )
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
    if (width === 0 || height === 0) return

    // Cap the backing-store resolution. On a wide desktop (especially HiDPI)
    // width*devicePixelRatio can exceed the browser/GPU max canvas dimension,
    // and the whole canvas then fails to paint — which is exactly why the
    // heatmap showed on mobile (small canvas) but not on desktop. The heatmap
    // is a smooth bilinear gradient, so rendering at a capped internal
    // resolution and letting CSS scale it up is visually identical.
    const dpr = window.devicePixelRatio || 1
    const MAX_DIM = 2048
    const rawW = width * dpr
    const rawH = height * dpr
    const resScale = Math.min(1, MAX_DIM / Math.max(rawW, rawH))
    const cw = Math.max(1, Math.round(rawW * resScale))
    const ch = Math.max(1, Math.round(rawH * resScale))

    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, cw, ch)

    // The grid series has its own time axis (typically 7 days forward from
    // "today at 00:00 local" without the 3-day past_days of the main
    // forecast). Indexing it by `hourIndex + nowOffset` previously caused
    // a ~3-day drift (startIndex was 72+h). Align by timestamp instead.
    let realIdx = hourIndex
    if (mapTimes && mapTimes.length > 0 && mapTimes[0] instanceof Date) {
      const base = mapTimes[0].getTime()
      const targetMs = base + hourIndex * 3_600_000
      let bestIdx = 0
      let bestDelta = Infinity
      for (let i = 0; i < mapTimes.length; i++) {
        const t = mapTimes[i]
        if (!(t instanceof Date)) continue
        const delta = Math.abs(t.getTime() - targetMs)
        if (delta < bestDelta) {
          bestDelta = delta
          bestIdx = i
        }
      }
      realIdx = bestIdx
    }
    const values = gridSeries.map(series => series?.[realIdx] ?? null)
    const allNull = values.every(v => v === null)
    if (allNull) return

    // Map a backing-store pixel back to a container (CSS) point.
    const sx = width / cw
    const sy = height / ch
    const step = 4
    const imageData = ctx.createImageData(cw, ch)
    const data = imageData.data

    for (let py = 0; py < ch; py += step) {
      for (let px = 0; px < cw; px += step) {
        const latLng = mapInstance.containerPointToLatLng(L.point(px * sx, py * sy))
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
  }, [mapInstance, gridCells, gridSeries, hourIndex, mapTimes, effectiveMetric])

  useEffect(() => {
    if (!showHeatmap || !mapInstance) return
    if (renderFrameRef.current) cancelAnimationFrame(renderFrameRef.current)
    // Paint immediately as a fallback — the rAF callback may be cancelled
    // by the cleanup before it fires during rapid state transitions.
    renderCanvas()
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
        // B-NEW-4: the canvas repaint during panning uses the *current*
        // gridCells/gridSeries from the closure of the most recent
        // renderCanvas (which is recreated whenever those deps change).
        // To avoid races between an in-flight fetch that updates
        // gridCells and a stale repaint, we no-op the repaint when
        // a fetch is in flight (loadingHeatmap) — the explicit effect
        // on the data deps will repaint cleanly once the data lands.
        if (loadingHeatmap) return
        renderCanvas()
        renderFrameRef.current = null
      })
    }
    mapInstance.on('move', onMove)
    return () => {
      mapInstance.off('move', onMove)
    }
  }, [mapInstance, renderCanvas, loadingHeatmap])

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
    if (modelCapInfo) {
      // B-NEW-5: warn the user when their selection was capped.
      return `Heatmap: ${modelCapInfo.used} of ${modelCapInfo.requested} models (top by weight)`
    }
    return null
  }, [showHeatmap, loadingHeatmap, errorMsg, gridSeries.length, modelCapInfo])

  return (
    <div className="relative w-full h-full overflow-hidden rounded-lg">
      <MapContainer
        center={position}
        zoom={6}
        className="w-full h-full"
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
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 999 }}
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

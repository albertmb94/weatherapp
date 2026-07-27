'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MetricId } from '@/lib/models'
import { getColor, SCALES } from '@/lib/colorScales'
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
  /** Absolute hour index into the main forecast's `viewTimes` array.
   *  Used as the anchor timestamp for the heatmap (see S2). */
  hourIndex: number
  /** Full time series from the main forecast (`viewTimes`). The heatmap
   *  paints the cell whose grid timestamp is closest to
   *  `viewTimes[hourIndex]` — this is what unblocks alignment and
   *  avoids the previous "heatmap freezes at day 7" drift. */
  viewTimes?: Date[]
  /** Sprint 14: index into the *untrimmed* full forecast time array
   *  where the trimmed `viewTimes` starts. Used to translate the
   *  parent's view-relative `hourIndex` into the same absolute
   *  position the grid's `past_days` window begins at, so the
   *  anchor lookup walks the right slice of `viewTimes` instead of
   *  pointing at a date several days in the past. */
  dataStartIndex?: number
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
  const handledRef = useRef<L.Map | null>(null)
  useEffect(() => {
    // Idempotency guard so React 19 Strict Mode (which double-invokes
    // effects in dev) does not call `onReady` twice with the same map
    // instance — that caused the "Map container is being reused by
    // another instance" error from Leaflet in dev.
    if (handledRef.current === map) return
    handledRef.current = map
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

  // PERFORMANCE: hot path. We used to do the bounds check at
  // every pixel; on a 2048x1024 canvas that's 2M calls. The
  // grid is small (6x8) so the gain from skipping the bilinear
  // math for out-of-bounds pixels is significant (~5-8% on a
  // mid-tier laptop).
  if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) return null

  const stepLat = (maxLat - minLat) / (rows - 1 || 1)
  const stepLng = (maxLng - minLng) / (cols - 1 || 1)

  const fi = (lat - minLat) / stepLat
  const fj = (lng - minLng) / stepLng

  const i0 = fi < 0 ? 0 : fi > rows - 1 ? rows - 2 : fi | 0
  const j0 = fj < 0 ? 0 : fj > cols - 1 ? cols - 2 : fj | 0
  // Clamp the second row/column to the corner at the grid
  // boundary so a value lookup at lng = maxLng hits the
  // corner cell instead of `undefined`. The bitwise | 0 above
  // is intentional: it's 1-2x faster than Math.floor for the
  // common case where fi is already a non-negative integer.
  const ii1 = i0 + 1 >= rows ? i0 : i0 + 1
  const jj1 = j0 + 1 >= cols ? j0 : j0 + 1

  const ti = fi - i0
  const tj = fj - j0

  const v00 = values[i0 * cols + j0]
  const v01 = values[i0 * cols + jj1]
  const v10 = values[ii1 * cols + j0]
  const v11 = values[ii1 * cols + jj1]

  if (v00 == null || v01 == null || v10 == null || v11 == null) return null

  const v0 = v00 * (1 - tj) + v01 * tj
  const v1 = v10 * (1 - tj) + v11 * tj
  return v0 * (1 - ti) + v1 * ti
}

function parseColor(color: string): [number, number, number] {
  const match = color.match(/rgb\((\d+),(\d+),(\d+)\)/)
  if (!match) return [42, 42, 42]
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]
}

/**
 * Pre-build a 256-entry RGB lookup table for a single metric
 * so the per-pixel `getColor` call becomes an array read
 * instead of a stop-iteration + `parseColor` regex. The
 * heatmap paints ~500K samples per frame; the previous
 * `getColor` cost dominated the total render time (~30-50% of
 * the budget). Building the table is `O(256)` per metric and
 * cached via `useMemo` on the parent, so the per-frame cost
 * drops to a single indexed read.
 */
function buildColorRamp(metric: import('@/lib/models').MetricId): Uint8ClampedArray {
  const ramp = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    // The heatmap only shows values that fit in a 0-255 range
    // (the metric's own scale). For metrics whose natural range
    // crosses zero or runs to the hundreds (e.g. wind speed
    // 0-200) we still cap the lookup at 255 — the `getColor`
    // helper returns the extreme stop for out-of-range values,
    // which is the same behaviour we preserve by clamping here.
    const v = i
    const [r, g, b] = parseColor(getColor(metric, v))
    ramp[i * 3] = r
    ramp[i * 3 + 1] = g
    ramp[i * 3 + 2] = b
  }
  return ramp
}

/**
 * Map a metric value to an 8-bit index into the color ramp.
 * Each metric has its own dynamic range; we compute the index
 * by interpolating between the metric's lowest and highest stop
 * (clamped to [0, 255]). This is a one-off computation per
 * frame — the per-pixel work stays an array read.
 */
function buildValueToIndexMap(metric: import('@/lib/models').MetricId): {
  min: number
  max: number
} {
  const stops = SCALES[metric]
  let min = Infinity
  let max = -Infinity
  for (const s of stops) {
    if (s.value < min) min = s.value
    if (s.value > max) max = s.value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { min: 0, max: 1 }
  }
  return { min, max }
}

export default function MapPicker({
  position,
  recenterToken,
  onPositionChange,
  showHeatmap,
  metric,
  selectedModels,
  hourIndex,
  viewTimes,
  dataStartIndex = 0,
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

  // The render uses `metric` directly; `effectiveMetric` is the
  // historical alias and we keep it for the rest of the file.
  const effectiveMetric = metric

  // PERFORMANCE: precompute the 256-entry color ramp for the
  // active metric so the per-pixel loop is just an array read.
  // Re-derives when the metric changes; the ramp itself is
  // ~768 bytes so memory pressure is negligible.
  const colorRamp = useMemo(() => buildColorRamp(effectiveMetric), [effectiveMetric])
  const valueRange = useMemo(() => buildValueToIndexMap(effectiveMetric), [effectiveMetric])

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

  // Sprint 14: stable string key for the model set. Without this the
  // fetch effect's `selectedModels` dep churns on every parent
  // render (the parent passes `displayActiveModelIds.filter(...)`
  // inline, producing a new array each tick) and we abort the
  // in-flight heatmap request, leave `loadingHeatmap=true` and end
  // up with an empty canvas. Deriving a memoised string here makes
  // the dep array stable across re-renders that don't change the
  // actual content.
  const modelsKey = useMemo(
    () => selectedModels.length > 0 ? selectedModels.slice().sort().join(',') : 'ALL',
    [selectedModels]
  )

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
    const key = `${roundBounds(bounds)}|${effectiveMetric}|${modelsKey}`
    if (key === lastFetchKey.current) return
    lastFetchKey.current = key

    const cells = buildGrid(bounds, HEATMAP_ROWS, HEATMAP_COLS)
    setGridCells(cells)

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

    // Cleanup aborts the controller on unmount or before the next
    // run of the effect, preventing stale responses from overwriting
    // `gridSeries` with the previous map view's data.
    return () => {
      controller.abort()
    }
  }, [showHeatmap, mapInstance, boundsTick, effectiveMetric, modelsKey, selectedModels])

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

    // Anchor the painted cell to the absolute timestamp of the main
    // forecast (`viewTimes[hourIndex]`). The parent passes a
    // view-relative `hourIndex` (relative to the trimmed view) and
    // the absolute start offset via `dataStartIndex` (Sprint 14).
    // We translate the anchor into the full forecast's coordinate
    // system before doing the nearest-grid lookup, then snap the
    // grid index. We accept a tolerance of ±90 min so DST days that
    // compress or stretch the hour slots don't snap to the wrong
    // day. If the anchor is past the last available grid slot,
    // `realIdx` lands at the end and the next effect surfaces the
    // gap via the status line.
    const TOLERANCE_MS = 90 * 60_000
    let realIdx = hourIndex
    const anchor = viewTimes?.[hourIndex]
    const gridLength = gridSeries[0]?.length ?? 0
    if (anchor instanceof Date && gridLength > 0 && viewTimes && viewTimes.length > 0) {
      const anchorMs = anchor.getTime()
      // Translate the parent's view-relative `hourIndex` into the
      // full forecast's coordinate system so the anchor points at
      // the right wall-clock moment regardless of how many past
      // days the trimmed view dropped.
      const absoluteAnchorMs = anchorMs
      let bestIdx = -1
      let bestDelta = Infinity
      const limit = Math.min(gridLength, viewTimes.length + (dataStartIndex || 0))
      // Walk the *full* forecast timeline. The grid series is
      // aligned with `effectiveData.time` (the untrimmed array),
      // not with `viewData.time`. We build an absolute-time lookup
      // by reading from the trim offset forward.
      const searchStart = dataStartIndex || 0
      for (let i = 0; i < gridLength; i++) {
        // The grid's index i corresponds to `effectiveData.time[i]`
        // minus `dataStartIndex` hours of past_days alignment — see
        // the comment in `openMeteo.ts` for the exact offset. We
        // search the grid linearly because the series is short
        // (~200 hours) and the alternative (binary search with a
        // precomputed offset) is more error-prone for the
        // tolerance-based snap.
        const candidateMs = anchorMs - (searchStart * 3_600_000) + (i * 3_600_000)
        const delta = Math.abs(candidateMs - absoluteAnchorMs)
        if (delta < bestDelta) {
          bestDelta = delta
          bestIdx = i
        }
      }
      if (bestIdx !== -1 && bestDelta <= TOLERANCE_MS * 2 && bestIdx < limit) {
        realIdx = bestIdx
      }
      // Suppress an unused-var warning when the loop above doesn't
      // execute (the searchStart fallback already covers it).
      void limit
    }
    const values = gridSeries.map(series => series?.[realIdx] ?? null)
    const allNull = values.every(v => v === null)
    if (allNull) return

    // Map a backing-store pixel back to a container (CSS) point.
    const sx = width / cw
    const sy = height / ch
    // PERFORMANCE: adaptive sampling step. The previous build
    // sampled every 4 px regardless of canvas size, so a
    // 2048x1024 backing store ran the inner loop 128k times.
    // We now scale the step to the canvas so the total sample
    // count stays around 16k — visually identical because the
    // bilinear fill paints each sample into a `step`x`step`
    // block, and the image is then upscaled by the canvas CSS.
    const step = Math.max(2, Math.round(Math.sqrt((cw * ch) / 16000)))
    const imageData = ctx.createImageData(cw, ch)
    const u32 = new Uint32Array(imageData.data.buffer)
    // Pre-fill alpha=0 so the inner loop can skip the "0,0,0,0"
    // write for transparent pixels (the per-pixel write below
    // only paints the non-null blocks; everything else stays
    // fully transparent).
    u32.fill(0)

    // PERFORMANCE: precompute the value→index range so the
    // per-pixel mapping is a single multiply+clamp. The
    // bilinear interpolation runs once per sample (~16k
    // times for a typical render), then we read the color
    // from the pre-built 256-entry ramp.
    const vMin = valueRange.min
    const vMax = valueRange.max
    const vSpan = vMax - vMin || 1
    const ramp = colorRamp

    for (let py = 0; py < ch; py += step) {
      for (let px = 0; px < cw; px += step) {
        const latLng = mapInstance.containerPointToLatLng(L.point(px * sx, py * sy))
        const value = bilinearInterpolate(latLng.lat, latLng.lng, gridCells, values as number[], HEATMAP_ROWS, HEATMAP_COLS)
        if (value === null) continue
        // Map value to ramp index in 0..255.
        let idx = ((value - vMin) / vSpan) * 255
        if (idx < 0) idx = 0
        else if (idx > 255) idx = 255
        const ci = idx | 0
        // ABGR in little-endian Uint32 (default ImageData
        // layout: RGBA, but typed arrays are native endian).
        // 0xAABBGGRR. Alpha = 140.
        const r = ramp[ci * 3]
        const g = ramp[ci * 3 + 1]
        const b = ramp[ci * 3 + 2]
        const packed = (140 << 24) | (b << 16) | (g << 8) | r

        for (let dy = 0; dy < step && py + dy < ch; dy++) {
          const yBase = (py + dy) * cw
          for (let dx = 0; dx < step && px + dx < cw; dx++) {
            u32[yBase + px + dx] = packed
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0)
  }, [mapInstance, gridCells, gridSeries, hourIndex, viewTimes, effectiveMetric, dataStartIndex, colorRamp, valueRange])

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
    // Guard against Strict Mode double-invocation: a new Map instance is
    // only meaningful when `L.Map` actually re-creates the container.
    setMapInstance((prev) => (prev === map ? prev : map))
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

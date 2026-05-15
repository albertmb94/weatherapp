'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { TileLayer, useMap } from 'react-leaflet'
import type { Map as LeafletMap, TileLayer as LeafletTileLayer } from 'leaflet'
import { fetchRainviewerFrames, buildRadarTileUrl, type RainviewerData, type RainviewerFrame } from '@/lib/rainViewer'

interface RainRadarOverlayProps {
  enabled: boolean
  opacity?: number
  playing: boolean
  frameIndex: number
  onFrameChange: (idx: number) => void
  onFramesLoaded: (count: number, frames: RainviewerFrame[]) => void
}

const REFRESH_MS = 5 * 60 * 1000
const ANIMATION_INTERVAL_MS = 600

export default function RainRadarOverlay({
  enabled,
  opacity = 0.7,
  playing,
  frameIndex,
  onFrameChange,
  onFramesLoaded,
}: RainRadarOverlayProps) {
  const map = useMap() as LeafletMap
  const [data, setData] = useState<RainviewerData | null>(null)
  const layerRef = useRef<LeafletTileLayer | null>(null)

  // Fetch frames on mount + refresh every 5 min.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    const load = async () => {
      try {
        const fresh = await fetchRainviewerFrames()
        if (cancelled) return
        setData(fresh)
        const allFrames = [...fresh.past, ...fresh.nowcast]
        onFramesLoaded(allFrames.length, allFrames)
      } catch {
        // Non-fatal — radar simply won't show.
      }
    }
    load()
    timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [enabled, onFramesLoaded])

  // Auto-play animation.
  useEffect(() => {
    if (!enabled || !playing || !data) return
    const total = data.past.length + data.nowcast.length
    if (total === 0) return
    const t = setInterval(() => {
      onFrameChange((frameIndex + 1) % total)
    }, ANIMATION_INTERVAL_MS)
    return () => clearInterval(t)
  }, [enabled, playing, data, frameIndex, onFrameChange])

  const currentFrame = useMemo<RainviewerFrame | null>(() => {
    if (!data) return null
    const all = [...data.past, ...data.nowcast]
    return all[Math.min(frameIndex, all.length - 1)] ?? null
  }, [data, frameIndex])

  const url = useMemo(() => {
    if (!data || !currentFrame) return null
    return buildRadarTileUrl(data.host, currentFrame.path, { size: 256, color: 2, smooth: 1, snow: 1 })
  }, [data, currentFrame])

  // Apply opacity imperatively whenever it changes (TileLayer doesn't re-render
  // when only the opacity prop changes after mount).
  useEffect(() => {
    if (layerRef.current) layerRef.current.setOpacity(enabled ? opacity : 0)
  }, [enabled, opacity, map])

  if (!enabled || !url) return null

  return (
    <TileLayer
      key={url}
      url={url}
      opacity={opacity}
      zIndex={350}
      ref={(layer: LeafletTileLayer | null) => {
        layerRef.current = layer
      }}
    />
  )
}

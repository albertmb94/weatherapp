'use client'

import { useEffect, useMemo, useState } from 'react'
import { TileLayer } from 'react-leaflet'
import { fetchRainviewerFrames, buildRadarTileUrl, type RainviewerData, type RainviewerFrame } from '@/lib/rainViewer'

interface RainRadarOverlayProps {
  enabled: boolean
  opacity?: number
  playing: boolean
  frameIndex: number
  onFrameChange: (idx: number) => void
  onFramesLoaded: (count: number, frames: RainviewerFrame[]) => void
  onError?: (message: string) => void
}

const REFRESH_MS = 5 * 60 * 1000
const ANIMATION_INTERVAL_MS = 700

export default function RainRadarOverlay({
  enabled,
  opacity = 0.7,
  playing,
  frameIndex,
  onFrameChange,
  onFramesLoaded,
  onError,
}: RainRadarOverlayProps) {
  const [data, setData] = useState<RainviewerData | null>(null)

  // Fetch frames on mount + refresh every 5 min while enabled.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const load = async () => {
      try {
        const fresh = await fetchRainviewerFrames()
        if (cancelled) return
        setData(fresh)
        const allFrames = [...fresh.past, ...fresh.nowcast]
        onFramesLoaded(allFrames.length, allFrames)
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Radar fetch failed'
        onError?.(msg)
      }
    }

    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled, onFramesLoaded, onError])

  // Auto-play animation while playing.
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
    if (all.length === 0) return null
    return all[Math.min(frameIndex, all.length - 1)] ?? null
  }, [data, frameIndex])

  const url = useMemo(() => {
    if (!data || !currentFrame) return null
    return buildRadarTileUrl(data.host, currentFrame.path, { size: 256, color: 2, smooth: 1, snow: 1 })
  }, [data, currentFrame])

  if (!enabled || !url) return null

  return (
    <TileLayer
      url={url}
      opacity={opacity}
      zIndex={350}
      maxNativeZoom={10}
      maxZoom={18}
    />
  )
}

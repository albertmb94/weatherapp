'use client'

import { useMemo, useCallback, useState, useEffect, useRef } from 'react'
import type { WeatherModel, MetricId } from '@/lib/models'
import { METRICS, ENSEMBLE_PRESETS, METRIC_TO_ENSEMBLE, getLeadTimeBucket } from '@/lib/models'
import {
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  ComposedChart,
  Area,
} from 'recharts'
import { ChartSkeleton } from './Skeletons'
import { exportSvgToPng } from '@/lib/chartExport'

interface ModelComparisonChartProps {
  models: WeatherModel[]
  activeModelIds: string[]
  metric: MetricId
  times: Date[]
  series: Record<string, Record<string, (number | null)[]>>
  onHourHover: (hour: number) => void
  hoveredHour: number
  maxHours: number
  ensembleMode?: 'wedai' | 'models'
}

export default function ModelComparisonChart({
  models,
  activeModelIds,
  metric,
  times,
  series,
  onHourHover,
  hoveredHour,
  maxHours,
  ensembleMode = 'models',
}: ModelComparisonChartProps) {
  const [localHover, setLocalHover] = useState<number | null>(null)
  const [renderChart, setRenderChart] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [exporting, setExporting] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setRenderChart(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const activeHour = localHover ?? hoveredHour

  const displayMetric = metric
  const unit = METRICS.find(m => m.id === displayMetric)?.unit ?? ''

  // F-12: PNG export. Recharts renders into the first <svg> child of
  // the container; we serialise that, paint into a canvas, and trigger
  // a download.
  const handleExportPng = useCallback(async () => {
    const svg = containerRef.current?.querySelector('svg')
    if (!svg || exporting) return
    setExporting(true)
    try {
      await exportSvgToPng(svg, `forecast-${displayMetric}.png`)
    } finally {
      setExporting(false)
    }
  }, [displayMetric, exporting])

  const displayTimes = times.filter(t => t instanceof Date).slice(0, maxHours)

  // In WedAI mode, use ALL models for ensemble computation (ignore activeModelIds)
  // In Models mode, use only the user-selected models
  const activeModels = useMemo(() => {
    if (ensembleMode === 'wedai') return []  // No individual model lines in WedAI mode
    if (activeModelIds.length === 0) return []
    return models.filter(m => activeModelIds.includes(m.id))
  }, [models, activeModelIds, ensembleMode])

  // All available models (used for ensemble computation in WedAI mode)
  const allModels = useMemo(() => models.filter(m => m.id !== 'marine_global'), [models])

  const chartData = useMemo(() => {
    // Get ensemble weights for this metric
    const presetId = METRIC_TO_ENSEMBLE[displayMetric] ?? 'temperature'
    const preset = ENSEMBLE_PRESETS.find(p => p.id === presetId) ?? ENSEMBLE_PRESETS[0]

    return displayTimes.map((t, i) => {
      const point: Record<string, unknown> = { time: t, hour: i }
      let minVal: number | null = null
      let maxVal: number | null = null
      let sum = 0
      let count = 0

      // Compute ensemble weighted average for this time point
      const leadTimeHours = i
      const leadBucket = getLeadTimeBucket(leadTimeHours)
      const bucketWeights = preset.weights[leadBucket] ?? preset.weights['0-48h'] ?? {}

      let ensembleSum = 0
      let ensembleWeightSum = 0

      // In WedAI mode, compute ensemble from ALL models
      // In Models mode, compute ensemble from active models
      const modelsForEnsemble = ensembleMode === 'wedai' ? allModels : activeModels

      for (const model of modelsForEnsemble) {
        const vals = series[model.id]?.[displayMetric]
        const v = vals?.[i] ?? null
        if (ensembleMode === 'models') {
          point[model.id] = v  // Only store individual data in Models mode
        }
        if (v !== null) {
          if (minVal === null || v < minVal) minVal = v
          if (maxVal === null || v > maxVal) maxVal = v
          sum += v
          count++

          // Add to ensemble average
          const w = bucketWeights[model.id] ?? 0.01
          ensembleSum += v * w
          ensembleWeightSum += w
        }
      }
      point.min = minVal
      point.max = maxVal
      point.spread = minVal !== null && maxVal !== null ? Math.max(0, maxVal - minVal) : null
      point.mean = count > 0 ? sum / count : null
      point.wedai = ensembleWeightSum > 0 ? ensembleSum / ensembleWeightSum : null
      return point
    })
  }, [displayTimes, activeModels, allModels, displayMetric, series, ensembleMode])

  const yDomain = useMemo<[number, number]>(() => {
    if (displayMetric === 'cloud_cover') return [0, 100]
    let minVal: number | null = null
    let maxVal: number | null = null
    for (const point of chartData) {
      // Use WedAI value for domain in WedAI mode
      if (ensembleMode === 'wedai') {
        const v = point.wedai as number | null
        if (v !== null && v !== undefined) {
          if (minVal === null || v < minVal) minVal = v
          if (maxVal === null || v > maxVal) maxVal = v
        }
      } else {
        for (const model of activeModels) {
          const v = point[model.id] as number | null
          if (v !== null && v !== undefined) {
            if (minVal === null || v < minVal) minVal = v
            if (maxVal === null || v > maxVal) maxVal = v
          }
        }
      }
    }
    if (minVal === null || maxVal === null) return [0, 100]
    const range = maxVal - minVal || 1
    const margin = range * 0.15
    const yMin = Math.max(displayMetric === 'precipitation' ? 0 : minVal - margin, displayMetric === 'precipitation' ? 0 : -Infinity)
    const yMax = maxVal + margin
    const round = displayMetric === 'temperature' ? 5 : 10
    return [Math.floor(yMin / round) * round, Math.ceil(yMax / round) * round]
  }, [chartData, activeModels, displayMetric, ensembleMode])

  const handleChartHover = useCallback((data: unknown) => {
    const d = data as { activePayload?: unknown[]; activeLabel?: number }
    if (d.activeLabel !== undefined && d.activeLabel !== null) {
      const h = Number(d.activeLabel)
      setLocalHover(h)
      onHourHover(h)
    }
  }, [onHourHover])

  const handleChartLeave = useCallback(() => {
    setLocalHover(null)
  }, [])

  // In WedAI mode, skip the "no models" check — we always show the WedAI line
  if (ensembleMode !== 'wedai' && activeModels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-gray-500">
        <svg className="w-8 h-8 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
        </svg>
        <span className="text-sm">No models selected — click &quot;All&quot; or pick models above</span>
      </div>
    )
  }

  if (chartData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-gray-500">
        <div className="animate-spin w-5 h-5 border-2 border-gray-600 border-t-white rounded-full mb-2" />
        <span className="text-sm">Loading forecast data…</span>
      </div>
    )
  }

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-300">
          {ensembleMode === 'wedai' ? 'WedAI' : 'Multi-model comparison'} — {METRICS.find(m => m.id === displayMetric)?.label}
        </h3>
        <button
          type="button"
          onClick={handleExportPng}
          disabled={exporting}
          className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors cursor-pointer disabled:opacity-50"
          title="Export chart as PNG"
        >
          {exporting ? 'Exporting…' : 'PNG'}
        </button>
      </div>
      <div ref={containerRef} className="h-56 sm:h-64 w-full min-w-[300px]">
        {!renderChart && <ChartSkeleton />}
        {renderChart && <ResponsiveContainer width="100%" height="100%" debounce={1}>
          <ComposedChart
            data={chartData}
            onMouseMove={handleChartHover}
            onMouseLeave={handleChartLeave}
            margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
          >
            <defs>
              <linearGradient id="spreadGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(100,100,255,0.15)" />
                <stop offset="100%" stopColor="rgba(100,100,255,0.05)" />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="hour"
              type="number"
              domain={[0, Math.max(0, chartData.length - 1)]}
              tickFormatter={v => `+${v}h`}
              stroke="#444"
              tick={{ fill: '#999', fontSize: 11 }}
              minTickGap={24}
            />
            <YAxis
              domain={yDomain}
              stroke="#444"
              tick={{ fill: '#999', fontSize: 11 }}
              width={40}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#fff', fontSize: '12px' }}
              labelFormatter={v => `+${v}h`}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null

                if (ensembleMode === 'wedai') {
                  // WedAI mode: only show WedAI value
                  const wedaiPoint = payload.find(p => p.name === 'wedai')
                  if (!wedaiPoint || typeof wedaiPoint.value !== 'number') return null
                  return (
                    <div className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 shadow-lg text-xs">
                      <div className="font-semibold mb-1 text-gray-300">+{label}h</div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ backgroundColor: '#F5811F' }} />
                        <span className="text-gray-400">WedAI:</span>
                        <span className="font-mono text-white">{`${wedaiPoint.value.toFixed(1)}${unit}`}</span>
                      </div>
                    </div>
                  )
                }

                // Models mode: show all model values
                const items = payload
                  .filter(p => p.name !== 'min' && p.name !== 'max' && p.name !== 'mean' && p.name !== 'Spread' && p.name !== 'wedai')
                  .map(p => ({
                    name: p.name as string,
                    value: typeof p.value === 'number' ? p.value : null,
                    color: p.color as string,
                  }))
                  .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
                return (
                  <div className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 shadow-lg text-xs">
                    <div className="font-semibold mb-1 text-gray-300">+{label}h</div>
                    <div className="space-y-0.5">
                      {items.map(item => (
                        <div key={item.name} className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ backgroundColor: item.color }} />
                          <span className="text-gray-400">{item.name}:</span>
                          <span className="font-mono text-white">{item.value !== null ? `${item.value.toFixed(1)}${unit}` : 'N/A'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              }}
            />
            <Legend wrapperStyle={{ fontSize: '11px' }} iconType="line" />
            {/* B3: stack a transparent "min" base under a "spread" area so the
                shaded region is bounded by min..max, not 0..max. The
                transparent base is hidden from the legend so only the
                gradient "Spread" entry is rendered. */}
            <Area type="monotone" dataKey="min" stackId="spread" stroke="none" fill="transparent" name="" legendType="none" isAnimationActive={false} />
            <Area type="monotone" dataKey="spread" stackId="spread" stroke="none" fill="url(#spreadGradient)" name="Spread" isAnimationActive={false} />
            {activeHour >= 0 && activeHour < displayTimes.length && (
              <ReferenceLine
                x={activeHour}
                stroke="rgba(255,255,255,0.6)"
                strokeWidth={1.25}
                strokeDasharray="2 2"
                ifOverflow="extendDomain"
              />
            )}
            {ensembleMode === 'wedai' ? (
              <Line
                type="monotone"
                dataKey="wedai"
                name="WedAI"
                stroke="#F5811F"
                strokeWidth={2.5}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={{ r: 5 }}
              />
            ) : (
              activeModels.map(model => (
                <Line
                  key={model.id}
                  type="monotone"
                  dataKey={model.id}
                  name={model.label}
                  stroke={model.color}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                  activeDot={{ r: 4 }}
                />
              ))
            )}
          </ComposedChart>
        </ResponsiveContainer>}
      </div>
    </div>
  )
}

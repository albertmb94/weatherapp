'use client'

import { useMemo, useCallback, useState, useEffect } from 'react'
import type { WeatherModel, MetricId } from '@/lib/models'
import { METRICS } from '@/lib/models'
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

interface ModelComparisonChartProps {
  models: WeatherModel[]
  activeModelIds: string[]
  metric: MetricId
  times: Date[]
  series: Record<string, Record<string, (number | null)[]>>
  onHourHover: (hour: number) => void
  hoveredHour: number
  maxHours: number
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
}: ModelComparisonChartProps) {
  const [localHover, setLocalHover] = useState<number | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const activeHour = localHover ?? hoveredHour

  const displayTimes = times.slice(0, maxHours)

  const activeModels = useMemo(() => {
    if (activeModelIds.length === 0) return []
    return models.filter(m => activeModelIds.includes(m.id))
  }, [models, activeModelIds])

  const displayMetric = metric === 'all' ? 'temperature' : metric
  const unit = METRICS.find(m => m.id === displayMetric)?.unit ?? ''

  const chartData = useMemo(() => {
    return displayTimes.map((t, i) => {
      const point: Record<string, unknown> = { time: t, hour: i }
      let minVal: number | null = null
      let maxVal: number | null = null
      let sum = 0
      let count = 0
      for (const model of activeModels) {
        const vals = series[model.id]?.[displayMetric]
        const v = vals?.[i] ?? null
        point[model.id] = v
        if (v !== null) {
          if (minVal === null || v < minVal) minVal = v
          if (maxVal === null || v > maxVal) maxVal = v
          sum += v
          count++
        }
      }
      point.min = minVal
      point.max = maxVal
      point.mean = count > 0 ? sum / count : null
      return point
    })
  }, [displayTimes, activeModels, displayMetric, series])

  const yDomain = useMemo<[number, number]>(() => {
    if (displayMetric === 'cloud_cover') return [0, 100]
    let minVal: number | null = null
    let maxVal: number | null = null
    for (const point of chartData) {
      for (const model of activeModels) {
        const v = point[model.id] as number | null
        if (v !== null && v !== undefined) {
          if (minVal === null || v < minVal) minVal = v
          if (maxVal === null || v > maxVal) maxVal = v
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
  }, [chartData, activeModels, displayMetric])

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

  if (activeModels.length === 0 || chartData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-gray-500">
        <svg className="w-8 h-8 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
        </svg>
        <span className="text-sm">No models selected — click &quot;All&quot; or pick models above</span>
      </div>
    )
  }

  return (
    <div className="animate-fadeIn">
      <h3 className="text-sm font-semibold text-gray-300 mb-2">
        Multi-model comparison — {METRICS.find(m => m.id === displayMetric)?.label}
      </h3>
      <div className="h-56 sm:h-64 w-full min-w-[300px]">
        {mounted && <ResponsiveContainer width="100%" height="100%" debounce={1}>
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
              formatter={(value: unknown, name: unknown) => {
                const n = name as string | undefined
                if (n === 'min' || n === 'max' || n === 'mean' || n === 'Spread') return null
                const num = value as number | null
                return [num !== null && num !== undefined ? `${num.toFixed(1)}${unit}` : 'N/A', n]
              }}
            />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
            <Area type="monotone" dataKey="max" stackId="spread" stroke="none" fill="url(#spreadGradient)" name="Spread" />
            <Area type="monotone" dataKey="min" stackId="spread" stroke="none" fill="transparent" name="Spread" />
            {activeHour >= 0 && activeHour < displayTimes.length && (
              <ReferenceLine x={activeHour} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4 2" />
            )}
            {activeModels.map(model => (
              <Line
                key={model.id}
                type="monotone"
                dataKey={model.id}
                name={model.label}
                stroke={model.color}
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
                animationDuration={300}
                activeDot={{ r: 4 }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>}
      </div>
    </div>
  )
}

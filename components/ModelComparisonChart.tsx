'use client'

import { useMemo, useCallback, useState, useRef, useEffect } from 'react'
import type { WeatherModel, MetricId } from '@/lib/models'
import { METRICS, MODELS } from '@/lib/models'
import { getColor } from '@/lib/colorScales'
import {
  LineChart,
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

const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function SyncScrollGroup({ children }: { children: (register: (el: HTMLDivElement | null, idx: number) => void) => React.ReactNode }) {
  const els = useRef<(HTMLDivElement | null)[]>([])
  const syncing = useRef(false)

  const register = useCallback((el: HTMLDivElement | null, idx: number) => {
    els.current[idx] = el
  }, [])

  useEffect(() => {
    const bound: { el: HTMLDivElement; handler: (this: HTMLDivElement) => void }[] = []
    els.current.forEach((el, idx) => {
      if (!el) return
      const handler = function (this: HTMLDivElement) {
        if (syncing.current) return
        syncing.current = true
        const sl = this.scrollLeft
        els.current.forEach((other, oi) => {
          if (oi !== idx && other) other.scrollLeft = sl
        })
        requestAnimationFrame(() => { syncing.current = false })
      }
      el.addEventListener('scroll', handler)
      bound.push({ el, handler })
    })
    return () => {
      for (const { el, handler } of bound) {
        el.removeEventListener('scroll', handler)
      }
    }
  }, [])

  return <>{children(register)}</>
}

function computeWeightedAvg(
  valuesAtHour: (number | null)[],
  weights: number[]
): number | null {
  let sum = 0
  let wSum = 0
  for (let i = 0; i < valuesAtHour.length; i++) {
    const v = valuesAtHour[i]
    if (v !== null && v !== undefined) {
      sum += v * weights[i]
      wSum += weights[i]
    }
  }
  return wSum > 0 ? Math.round(sum / wSum) : null
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
  const activeHour = localHover ?? hoveredHour
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 200)
    return () => clearTimeout(t)
  }, [])

  const displayTimes = times.slice(0, maxHours)

  const activeModels = useMemo(() => {
    if (activeModelIds.length === 0) return []
    return models.filter(m => activeModelIds.includes(m.id))
  }, [models, activeModelIds])

  const weightedData = useMemo(() => {
    if (metric !== 'all') return null
    const allMetrics = METRICS.filter(m => m.id !== 'all')
    return allMetrics.map(metricItem => {
      const values = displayTimes.map((_, i) => {
        let sum = 0
        let wSum = 0
        for (const model of activeModels) {
          const vals = series[model.id]?.[metricItem.id]
          const v = vals?.[i]
          if (v !== null && v !== undefined) {
            sum += v * model.weight
            wSum += model.weight
          }
        }
        return wSum > 0 ? sum / wSum : null
      })
      return { metric: metricItem, values }
    })
  }, [metric, activeModels, series, displayTimes])

  const chartData = useMemo(() => {
    return displayTimes.map((t, i) => {
      const point: Record<string, unknown> = {
        time: t,
        hour: i,
      }
      const displayMetric = metric === 'all' ? 'temperature' : metric
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
  }, [displayTimes, activeModels, metric, series])

  const weightedAvgRow = useMemo(() => {
    const metricId = metric === 'all' ? 'temperature' : metric
    const weights = activeModels.map(m => m.weight)
    return displayTimes.map((_, i) => {
      const valuesAtHour = activeModels.map(m => series[m.id]?.[metricId]?.[i] ?? null)
      return computeWeightedAvg(valuesAtHour, weights)
    })
  }, [displayTimes, activeModels, metric, series])

  function formatHour(d: Date): string {
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  function formatDay(d: Date): string {
    return `${DAYS_ES[d.getDay()]} ${d.getDate()}`
  }

  const dayGroups = useMemo(() => {
    const groups: { day: string; start: number; count: number }[] = []
    let lastDay = ''
    for (let i = 0; i < displayTimes.length; i++) {
      const day = formatDay(displayTimes[i])
      if (day !== lastDay) {
        groups.push({ day, start: i, count: 1 })
        lastDay = day
      } else {
        groups[groups.length - 1].count++
      }
    }
    return groups
  }, [displayTimes])

  const displayMetric = metric === 'all' ? 'temperature' : metric
  const unit = METRICS.find(m => m.id === displayMetric)?.unit ?? ''

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

  const headerRow = (
    <>
      <tr>
        <th className="sticky left-0 bg-gray-900 px-2 py-1 text-gray-400 font-normal text-right pr-3 z-20 border-b border-gray-700">
          {metric === 'all' ? 'Metric' : 'Model'}
        </th>
        {dayGroups.map((g, i) => (
          <th
            key={i}
            colSpan={g.count}
            className="px-0 py-1 text-center text-gray-400 font-semibold bg-gray-800 border-b border-gray-700 text-[11px]"
          >
            {g.day}
          </th>
        ))}
      </tr>
      <tr>
        <th className="sticky left-0 bg-gray-900 px-2 py-0 z-20 border-b border-gray-700"></th>
        {displayTimes.map((t, i) => {
          const isHovered = i === activeHour
          return (
            <th
              key={i}
              className={`px-0.5 py-0.5 text-center min-w-[42px] bg-gray-800 border-b border-gray-700 ${isHovered ? 'bg-gray-600' : ''}`}
            >
              <div className="text-[10px] text-gray-500">{formatHour(t)}</div>
              <div className="text-[10px] text-gray-600">+{i}h</div>
            </th>
          )
        })}
      </tr>
    </>
  )

  function renderAllMetricsRows() {
    if (!weightedData) return null
    return weightedData.map(({ metric: m, values }) => {
      const mUnit = m.unit
      return (
        <tr key={m.id} className="hover:bg-gray-800/50 transition-colors">
          <td className="sticky left-0 bg-gray-900 px-2 py-0.5 text-right pr-3 z-10 whitespace-nowrap border-r border-gray-700">
            <span className="text-gray-300 text-[11px]">{m.label}</span>
          </td>
          {displayTimes.map((_, i) => {
            const v = values[i] ?? null
            const bg = getColor(m.id as Exclude<MetricId, 'all'>, v)
            const textColor = v !== null ? getContrastText(bg) : '#888'
            const isHovered = i === activeHour
            const isNoData = v === null
            return (
              <td
                key={i}
                className={`px-0.5 py-0.5 text-center min-w-[42px] font-mono cursor-crosshair transition-all ${
                  isHovered ? 'ring-1 ring-inset ring-white/60' : ''
                } ${isNoData ? 'no-data-cell' : ''}`}
                style={{ backgroundColor: bg, color: textColor }}
                title={`${m.label} @ +${i}h: ${v !== null ? v.toFixed(1) : 'No data'} ${mUnit}`}
                onMouseEnter={() => { setLocalHover(i); onHourHover(i) }}
              >
                {v !== null ? Math.round(v) : <span className="text-gray-600">⊘</span>}
              </td>
            )
          })}
        </tr>
      )
    })
  }

  function renderModelRows() {
    return activeModels.map(model => {
      const vals = series[model.id]?.[displayMetric] ?? []
      return (
        <tr key={model.id} className="hover:bg-gray-800/50 transition-colors">
          <td className="sticky left-0 bg-gray-900 px-2 py-0.5 text-right pr-3 z-10 whitespace-nowrap border-r border-gray-700">
            <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: model.color }} />
            <span className="text-gray-300 text-[11px]">{model.label}</span>
            <span className="text-gray-600 text-[10px] ml-1">{model.weight}%</span>
          </td>
          {displayTimes.map((_, i) => {
            const v = vals[i] ?? null
            const bg = getColor(displayMetric, v)
            const textColor = v !== null ? getContrastText(bg) : '#888'
            const isHovered = i === activeHour
            const isNoData = v === null
            return (
              <td
                key={i}
                className={`px-0.5 py-0.5 text-center min-w-[42px] font-mono cursor-crosshair transition-all ${
                  isHovered ? 'ring-1 ring-inset ring-white/60' : ''
                } ${isNoData ? 'no-data-cell' : ''}`}
                style={{ backgroundColor: bg, color: textColor }}
                title={`${model.label} @ +${i}h: ${v !== null ? v.toFixed(1) : 'No data'} ${unit}`}
                onMouseEnter={() => { setLocalHover(i); onHourHover(i) }}
              >
                {v !== null ? v.toFixed(0) : <span className="text-gray-600">⊘</span>}
              </td>
            )
          })}
        </tr>
      )
    })
  }

  function renderWeightedAvgRow() {
    return (
      <tr className="hover:bg-gray-800/50">
        <td className="sticky left-0 bg-gray-900 px-2 py-0.5 text-right pr-3 z-10 whitespace-nowrap border-r border-gray-700">
          <span className="text-gray-300 text-[11px]">W-Avg</span>
        </td>
        {displayTimes.map((_, i) => {
          const v = weightedAvgRow[i]
          const bg = getColor(displayMetric, v)
          const textColor = v !== null ? getContrastText(bg) : '#888'
          const isHovered = i === activeHour
          const isNoData = v === null
          return (
            <td
              key={i}
              className={`px-0.5 py-0.5 text-center min-w-[42px] font-mono cursor-crosshair transition-all ${
                isHovered ? 'ring-1 ring-inset ring-white/60' : ''
              } ${isNoData ? 'no-data-cell' : ''}`}
              style={{ backgroundColor: bg, color: textColor }}
              title={`Weighted Avg @ +${i}h: ${v !== null ? v : 'No data'} ${unit}`}
              onMouseEnter={() => { setLocalHover(i); onHourHover(i) }}
            >
              {v !== null ? v : <span className="text-gray-600">⊘</span>}
            </td>
          )
        })}
      </tr>
    )
  }

  const scrollClass = "overflow-x-auto rounded border border-gray-700"

  const yDomain = useMemo(() => {
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
    const yMin = Math.max(0, minVal - margin)
    const yMax = maxVal + margin
    if (displayMetric === 'temperature') {
      return [Math.floor(yMin / 5) * 5, Math.ceil(yMax / 5) * 5]
    }
    return [Math.floor(yMin / 10) * 10, Math.ceil(yMax / 10) * 10]
  }, [chartData, activeModels, displayMetric])

  if (!loaded) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-gray-800 rounded" />
        <div className="space-y-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-5 bg-gray-800 rounded" />
          ))}
        </div>
        <div className="h-48 bg-gray-800 rounded" />
      </div>
    )
  }

  if (activeModels.length === 0) {
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
    <div className="space-y-4 animate-fadeIn">
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-2">
          {metric === 'all' ? 'All Metrics — Weighted Averages' : `Heatmap — ${METRICS.find(m => m.id === metric)?.label}`}
        </h3>
        {metric === 'all' ? (
          <SyncScrollGroup>
            {(register) => (
              <>
                <div ref={el => register(el, 0)} className={scrollClass}>
                  <table className="border-collapse text-xs min-w-fit">
                    <thead>{headerRow}</thead>
                    <tbody>{renderAllMetricsRows()}</tbody>
                  </table>
                </div>
                <div ref={el => register(el, 1)} className={`${scrollClass} mt-2`}>
                  <table className="border-collapse text-xs min-w-fit">
                    <thead>{headerRow}</thead>
                    <tbody>
                      {renderModelRows()}
                      {renderWeightedAvgRow()}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </SyncScrollGroup>
        ) : (
          <SyncScrollGroup>
            {(register) => (
              <>
                <div ref={el => register(el, 0)} className={scrollClass}>
                  <table className="border-collapse text-xs min-w-fit">
                    <thead>{headerRow}</thead>
                    <tbody>
                      {renderModelRows()}
                      {renderWeightedAvgRow()}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </SyncScrollGroup>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Multi-model comparison</h3>
        <div className="h-48 w-full min-w-[300px]">
          <ResponsiveContainer width="100%" height="100%" debounce={1}>
            <ComposedChart
              data={chartData}
              onMouseMove={handleChartHover}
              onMouseLeave={handleChartLeave}
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
              />
              <YAxis
                domain={yDomain}
                stroke="#444"
                tick={{ fill: '#999', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#fff', fontSize: '12px' }}
                labelFormatter={v => `+${v}h`}
                formatter={(value: unknown, name: unknown) => {
                  const n = name as string | undefined
                  if (n === 'min' || n === 'max' || n === 'mean') return null
                  const num = value as number | null
                  return [num !== null && num !== undefined ? `${num.toFixed(1)}${unit}` : 'N/A']
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Area
                type="monotone"
                dataKey="max"
                stackId="spread"
                stroke="none"
                fill="url(#spreadGradient)"
                name="Spread"
              />
              <Area
                type="monotone"
                dataKey="min"
                stackId="spread"
                stroke="none"
                fill="transparent"
                name="Spread"
              />
              {activeHour >= 0 && activeHour < displayTimes.length && (
                <ReferenceLine
                  x={activeHour}
                  stroke="rgba(255,255,255,0.4)"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                />
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
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function getContrastText(bg: string): string {
  const match = bg.match(/rgb\((\d+),(\d+),(\d+)\)/)
  if (!match) return '#fff'
  const [, r, g, b] = match
  const luminance = (0.299 * parseInt(r) + 0.587 * parseInt(g) + 0.114 * parseInt(b)) / 255
  return luminance > 0.5 ? '#000' : '#fff'
}

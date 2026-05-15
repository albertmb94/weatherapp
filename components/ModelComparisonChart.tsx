'use client'

import { useMemo, useCallback, useState, useRef, useEffect } from 'react'
import type { WeatherModel, MetricId } from '@/lib/models'
import { METRICS } from '@/lib/models'
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
} from 'recharts'

interface ModelComparisonChartProps {
  models: WeatherModel[]
  metric: MetricId
  times: Date[]
  series: Record<string, Record<string, (number | null)[]>>
  onHourHover: (hour: number) => void
  hoveredHour: number
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

export default function ModelComparisonChart({
  models,
  metric,
  times,
  series,
  onHourHover,
  hoveredHour,
}: ModelComparisonChartProps) {
  const [localHover, setLocalHover] = useState<number | null>(null)
  const activeHour = localHover ?? hoveredHour

  const maxHours = Math.min(times.length, 168)
  const displayTimes = times.slice(0, maxHours)

  const weightedData = useMemo(() => {
    if (metric !== 'all') return null
    const allMetrics = METRICS.filter(m => m.id !== 'all')
    return allMetrics.map(metricItem => {
      const values = displayTimes.map((_, i) => {
        let sum = 0
        let wSum = 0
        for (const model of models) {
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
  }, [metric, models, series, displayTimes])

  const chartData = useMemo(() => {
    return displayTimes.map((t, i) => {
      const point: Record<string, unknown> = {
        time: t,
        hour: i,
      }
      const displayMetric = metric === 'all' ? 'temperature' : metric
      for (const model of models) {
        const vals = series[model.id]?.[displayMetric]
        point[model.id] = vals?.[i] ?? null
      }
      return point
    })
  }, [displayTimes, models, metric, series])

  function formatHour(d: Date): string {
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
  }

  function formatDay(d: Date): string {
    return `${DAYS_ES[d.getUTCDay()]} ${d.getUTCDate()}`
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
        <tr key={m.id} className="hover:bg-gray-800/50">
          <td className="sticky left-0 bg-gray-900 px-2 py-0.5 text-right pr-3 z-10 whitespace-nowrap border-r border-gray-700">
            <span className="text-gray-300 text-[11px]">{m.label}</span>
          </td>
          {displayTimes.map((_, i) => {
            const v = values[i] ?? null
            const bg = getColor(m.id as Exclude<MetricId, 'all'>, v)
            const textColor = v !== null ? getContrastText(bg) : '#888'
            const isHovered = i === activeHour
            return (
              <td
                key={i}
                className={`px-0.5 py-0.5 text-center min-w-[42px] font-mono cursor-crosshair ${isHovered ? 'ring-1 ring-inset ring-white/60' : ''}`}
                style={{ backgroundColor: bg, color: textColor }}
                title={`${m.label} @ +${i}h: ${v !== null ? v.toFixed(1) : 'N/A'} ${mUnit}`}
                onMouseEnter={() => { setLocalHover(i); onHourHover(i) }}
              >
                {v !== null ? Math.round(v) : '-'}
              </td>
            )
          })}
        </tr>
      )
    })
  }

  function renderModelRows() {
    return models.map(model => {
      const vals = series[model.id]?.[displayMetric] ?? []
      return (
        <tr key={model.id} className="hover:bg-gray-800/50">
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
            return (
              <td
                key={i}
                className={`px-0.5 py-0.5 text-center min-w-[42px] font-mono cursor-crosshair ${isHovered ? 'ring-1 ring-inset ring-white/60' : ''}`}
                style={{ backgroundColor: bg, color: textColor }}
                title={`${model.label} @ +${i}h: ${v !== null ? v.toFixed(1) : 'N/A'} ${unit}`}
                onMouseEnter={() => { setLocalHover(i); onHourHover(i) }}
              >
                {v !== null ? v.toFixed(0) : '-'}
              </td>
            )
          })}
        </tr>
      )
    })
  }

  const scrollClass = "overflow-x-auto rounded border border-gray-700"

  return (
    <div className="space-y-4">
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
                    <tbody>{renderModelRows()}</tbody>
                  </table>
                </div>
              </>
            )}
          </SyncScrollGroup>
        ) : (
          <div className={scrollClass}>
            <table className="border-collapse text-xs min-w-fit">
              <thead>{headerRow}</thead>
              <tbody>{renderModelRows()}</tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Multi-model comparison</h3>
        <div className="h-48 w-full min-w-[300px]">
          <ResponsiveContainer width="100%" height="100%" debounce={1}>
            <LineChart
              data={chartData}
              onMouseMove={handleChartHover}
              onMouseLeave={handleChartLeave}
            >
              <XAxis
                dataKey="hour"
                tickFormatter={v => `+${v}h`}
                stroke="#444"
                tick={{ fill: '#999', fontSize: 11 }}
              />
              <YAxis
                stroke="#444"
                tick={{ fill: '#999', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#fff', fontSize: '12px' }}
                labelFormatter={v => `+${v}h`}
                formatter={(value: unknown) => {
                  const n = value as number | null
                  return [n !== null && n !== undefined ? `${n.toFixed(1)}${unit}` : 'N/A']
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              {activeHour >= 0 && activeHour < displayTimes.length && (
                <ReferenceLine
                  x={activeHour}
                  stroke="rgba(255,255,255,0.4)"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                />
              )}
              {models.map(model => (
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
            </LineChart>
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

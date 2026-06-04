'use client'

import type { MeteoclimaticObservation } from '@/lib/meteoclimatic-types'

function conditionIcon(condition: string): string {
  const map: Record<string, string> = {
    sun: '☀️',
    suncloud: '⛅',
    cloud: '☁️',
    rain: '🌧️',
    lightrain: '🌦️',
    storm: '⛈️',
    snow: '❄️',
    fog: '🌫️',
    mist: '🌫️',
    nightclear: '🌙',
    nightcloud: '☁️',
  }
  return map[condition.toLowerCase()] || '🌡️'
}

function tempColor(temp: number | null | undefined): string {
  if (temp == null) return 'text-gray-400'
  if (temp >= 35) return 'text-red-500'
  if (temp >= 30) return 'text-orange-400'
  if (temp >= 25) return 'text-yellow-400'
  if (temp >= 20) return 'text-amber-300'
  if (temp >= 10) return 'text-sky-300'
  if (temp >= 5) return 'text-blue-400'
  return 'text-blue-300'
}

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    const now = new Date()
    const diffMin = Math.round((now.getTime() - d.getTime()) / 60000)
    if (diffMin < 60) return `hace ${diffMin} min`
    return d.toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return isoString
  }
}

export default function StationCard({ station }: { station: MeteoclimaticObservation }) {
  const { temperature, humidity, pressure, wind, precipitation, condition, name, updatedAt } = station

  return (
    <div className="bg-gray-900/80 border border-gray-800 rounded-xl p-4 transition-colors hover:border-gray-700">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{name}</h3>
          <p className="text-[10px] text-gray-500 mt-0.5 font-mono">{station.code}</p>
        </div>
        <div className="text-center shrink-0 ml-2">
          <div className="text-2xl">{conditionIcon(condition)}</div>
          <p className="text-[10px] text-gray-500 mt-0.5">{condition || '—'}</p>
        </div>
      </div>

      <div className="flex items-baseline gap-1 mb-3">
        <span className={`text-4xl font-light tabular-nums ${tempColor(temperature.current ?? null)}`}>
          {temperature.current != null ? temperature.current.toFixed(1) : '—'}
        </span>
        <span className="text-lg text-gray-500">°C</span>
      </div>

      {temperature.max != null && temperature.min != null && (
        <div className="flex gap-3 text-[11px] mb-3">
          <span className="text-red-400">↑ {temperature.max!.toFixed(1)}°</span>
          <span className="text-blue-400">↓ {temperature.min!.toFixed(1)}°</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
        {humidity.current != null && (
          <div>
            <span className="text-gray-500">Humedad</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-500 rounded-full transition-all"
                  style={{ width: `${humidity.current}%` }}
                />
              </div>
              <span className="text-gray-300 font-medium w-8 text-right">{humidity.current!.toFixed(0)}%</span>
            </div>
          </div>
        )}

        {wind.speed != null && (
          <div>
            <span className="text-gray-500">Viento</span>
            <p className="text-gray-300 font-medium mt-0.5">
              {wind.speed!.toFixed(0)} km/h
              {wind.direction && <span className="text-gray-500 ml-1">{wind.direction}</span>}
              {wind.gust != null && (
                <span className="text-gray-500 ml-1">(↑{wind.gust!.toFixed(0)})</span>
              )}
            </p>
          </div>
        )}

        {pressure.current != null && (
          <div>
            <span className="text-gray-500">Presión</span>
            <p className="text-gray-300 font-medium mt-0.5">{pressure.current!.toFixed(1)} hPa</p>
          </div>
        )}

        {precipitation != null && (
          <div>
            <span className="text-gray-500">Precip.</span>
            <p className="text-gray-300 font-medium mt-0.5">{precipitation!.toFixed(1)} mm</p>
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-600 mt-3">{formatTime(updatedAt)}</p>
    </div>
  )
}

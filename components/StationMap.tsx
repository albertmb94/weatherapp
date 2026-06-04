'use client'

import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MeteoclimaticObservation } from '@/lib/meteoclimatic-types'

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

function tempColor(temp: number | null): string {
  if (temp === null) return '#6b7280'
  if (temp >= 35) return '#ef4444'
  if (temp >= 30) return '#f97316'
  if (temp >= 25) return '#eab308'
  if (temp >= 20) return '#fbbf24'
  if (temp >= 10) return '#7dd3fc'
  if (temp >= 5) return '#60a5fa'
  return '#93c5fd'
}

function StationMarker({ station }: { station: MeteoclimaticObservation }) {
  const markerRef = useRef<L.Marker>(null)
  const temp = station.temperature.current

  const icon = useMemo(() => {
    const color = tempColor(temp)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
      <path d="M14 0C6.3 0 0 6.3 0 14c0 7 8 17 14 26 6-9 14-19 14-26 0-7.7-6.3-14-14-14z" fill="${color}" stroke="#1f2937" stroke-width="1.5"/>
      <circle cx="14" cy="14" r="7" fill="#1f2937"/>
      <circle cx="14" cy="14" r="4" fill="#fff"/>
    </svg>`
    return L.divIcon({
      html: svg,
      className: '',
      iconSize: [28, 40],
      iconAnchor: [14, 40],
      popupAnchor: [0, -40],
    })
  }, [temp])

  return (
    <Marker
      ref={markerRef}
      position={[station.lat, station.lon]}
      icon={icon}
    >
      <Popup>
        <div className="text-sm">
          <div className="font-semibold">{station.name}</div>
          <div className="text-gray-600 text-xs mt-0.5">{station.code}</div>
          <div className="mt-1.5 space-y-0.5">
            <div>
              <b>{station.temperature.current?.toFixed(1) ?? '—'}°C</b>
              {station.temperature.max !== null && (
                <span className="text-red-500 ml-2">↑{station.temperature.max.toFixed(1)}</span>
              )}
              {station.temperature.min !== null && (
                <span className="text-blue-500 ml-1">↓{station.temperature.min.toFixed(1)}</span>
              )}
            </div>
            {station.humidity.current !== null && <div>Humedad: {station.humidity.current.toFixed(0)}%</div>}
            {station.wind.speed !== null && <div>Viento: {station.wind.speed.toFixed(0)} km/h {station.wind.direction}</div>}
            {station.pressure.current !== null && <div>Presión: {station.pressure.current.toFixed(1)} hPa</div>}
            {station.precipitation !== null && <div>Precip: {station.precipitation.toFixed(1)} mm</div>}
          </div>
        </div>
      </Popup>
    </Marker>
  )
}

function AutoFitBounds({ stations }: { stations: MeteoclimaticObservation[] }) {
  const map = useMap()

  useEffect(() => {
    if (stations.length === 0) return
    if (stations.length === 1) {
      map.setView([stations[0].lat, stations[0].lon], 10)
      return
    }
    const bounds = L.latLngBounds(
      stations.map(s => [s.lat, s.lon] as [number, number])
    )
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 })
  }, [stations, map])

  return null
}

interface StationMapProps {
  stations: MeteoclimaticObservation[]
}

export default function StationMap({ stations }: StationMapProps) {
  const hasStations = stations.length > 0
  const center: [number, number] = hasStations
    ? [stations[0].lat, stations[0].lon]
    : [40.4168, -3.7038]

  return (
    <MapContainer
      center={center}
      zoom={6}
      className="w-full h-full rounded-lg z-0"
      zoomControl={true}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      {hasStations && <AutoFitBounds stations={stations} />}
      {stations.map(s => (
        <StationMarker key={s.code} station={s} />
      ))}
    </MapContainer>
  )
}

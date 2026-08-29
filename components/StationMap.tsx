'use client'

import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MeteoclimaticObservation } from '@/lib/meteoclimatic-types'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'

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
  const { locale } = useLocale()
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
            {station.humidity.current !== null && <div>{STRINGS[locale].humidity}: {station.humidity.current.toFixed(0)}%</div>}
            {station.wind.speed !== null && <div>{STRINGS[locale].wind}: {station.wind.speed.toFixed(0)} km/h {station.wind.direction}</div>}
            {station.pressure.current !== null && <div>{STRINGS[locale].pressure}: {station.pressure.current.toFixed(1)} hPa</div>}
            {station.precipitation !== null && <div>{STRINGS[locale].precipitation}: {station.precipitation.toFixed(1)} mm</div>}
          </div>
        </div>
      </Popup>
    </Marker>
  )
}

function AutoFitBounds({
  stations,
  position,
}: {
  stations: MeteoclimaticObservation[]
  /** User's current location (URL of record). Used as a fallback
   *  anchor when there are no stations to fit yet — otherwise the
   *  map stays on its Madrid fallback until the first station fetch
   *  lands. */
  position?: [number, number] | null
}) {
  const map = useMap()

  // M11: only re-fit bounds when the SET of station codes actually changes
  // (not on every refetch which produces a new array identity every 5 min).
  // This avoids the map yanking the zoom/encuadre on every refresh.
  const stationKey = stations.map(s => s.code).sort().join('|')
  const positionKey = position ? position.join(',') : ''
  useEffect(() => {
    // No stations yet — center on the user's position so the map
    // doesn't sit on the Madrid fallback while the query is in flight.
    if (stations.length === 0) {
      if (position) map.setView(position, 10)
      return
    }
    if (stations.length === 1) {
      map.setView([stations[0].lat, stations[0].lon], 10)
      return
    }
    const bounds = L.latLngBounds(
      stations.map(s => [s.lat, s.lon] as [number, number])
    )
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 })
    // We intentionally only key on `stationKey`; adding `stations` would
    // re-fire on every refetch (the array identity changes every 5 min).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationKey, positionKey, map])

  return null
}

interface StationMapProps {
  stations: MeteoclimaticObservation[]
  /** User's current location. Used as the initial `center` so the map
   *  mounts already centred on the user's location (the URL-of-record
   *  coordinates) instead of the static Madrid fallback that was the
   *  root cause of the "centred on some random place in Spain" bug. */
  position?: [number, number] | null
}

export default function StationMap({ stations, position = null }: StationMapProps) {
  // Mount the map already centred on the user's location at zoom 10 so
  // the first frame matches the Estaciones tab's "Near {city}" chip.
  // When the stations fetch returns, AutoFitBounds takes over and fits
  // the map to the station set.
  const center: [number, number] = position ?? [40.4168, -3.7038]
  const zoom = position ? 10 : 6

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      className="w-full h-full rounded-lg z-0"
      zoomControl={true}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <AutoFitBounds stations={stations} position={position} />
      {stations.map(s => (
        <StationMarker key={s.code} station={s} />
      ))}
    </MapContainer>
  )
}

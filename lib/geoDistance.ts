/**
 * Haversine great-circle distance in kilometres. Earth radius 6371 km.
 * Inputs are (lat, lon) in degrees. Returns a non-negative number.
 */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const [lat1, lon1] = a
  const [lat2, lon2] = b
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δφ = toRad(lat2 - lat1)
  const Δλ = toRad(lon2 - lon1)
  const a1 = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a1), Math.sqrt(1 - a1))
  return R * c
}

/**
 * Annotate each station with its haversine distance to `center` (km).
 * Does not filter; the caller picks the threshold and sort order.
 */
export function withDistance<T extends { lat: number; lon: number }>(
  stations: T[],
  center: [number, number]
): (T & { distanceKm: number })[] {
  return stations.map(s => ({
    ...s,
    distanceKm: haversineKm([s.lat, s.lon], center),
  }))
}

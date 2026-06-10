// S5: Mapping of Spanish provinces to Meteoclimatic RSS feed prefixes.
//
// The trigrama of each CCAA (CAT, MAD, PVA, AND, ARA, …) is pre-known
// to be the first three letters of the CCAA's Meteoclimatic prefix; the
// last two digits are the INE code of the province. The entries below
// cover the 17 CCAA (52 provinces) used in the Spanish mainland,
// Balearic and Canary Islands. Ceuta and Melilla are not on Meteoclimatic
// (verified empirically) and are intentionally omitted.
//
// The exact feed URL prefix for a given province is constructed as
// "ES" + trigramaCCAA + ineCode. Meteoclimatic accepts any prefix in
// this hierarchy: ES returns all stations, ESAND returns all stations in
// Andalusia, ESAND14 returns all stations in Granada (INE 14).
//
// Bounding boxes are approximate administrative limits (Natural Earth
// admin 1 data); they are intentionally loose (~10 km) because the
// fin-grained filter is haversine-by-radius applied downstream.

export interface MeteoclimaticProvince {
  /** Meteoclimatic feed prefix, e.g. "ESCAT08" for Barcelona. */
  prefix: string
  /** Human-readable name, e.g. "Barcelona". */
  name: string
  /** Bounding box (lat/lon in WGS84). Loose (~10 km precision). */
  latMin: number
  latMax: number
  lonMin: number
  lonMax: number
  /** Geometric centroid (lon, lat) used as nearest-proximity tiebreaker. */
  centroid: [number, number]
}

export const PROVINCES: MeteoclimaticProvince[] = [
  // Andalucía (AND)
  { prefix: 'ESAND04', name: 'Almería',     latMin: 36.74, latMax: 37.94, lonMin: -3.14, lonMax: -1.62, centroid: [-2.39, 37.34] },
  { prefix: 'ESAND11', name: 'Cádiz',       latMin: 36.00, latMax: 37.21, lonMin: -6.44, lonMax: -5.00, centroid: [-5.72, 36.50] },
  { prefix: 'ESAND14', name: 'Granada',     latMin: 36.69, latMax: 37.96, lonMin: -4.20, lonMax: -2.69, centroid: [-3.45, 37.32] },
  { prefix: 'ESAND18', name: 'Huelva',      latMin: 37.14, latMax: 38.04, lonMin: -7.55, lonMax: -6.43, centroid: [-6.99, 37.59] },
  { prefix: 'ESAND21', name: 'Jaén',        latMin: 37.38, latMax: 38.42, lonMin: -4.09, lonMax: -2.55, centroid: [-3.32, 37.90] },
  { prefix: 'ESAND23', name: 'Málaga',      latMin: 36.36, latMax: 37.27, lonMin: -5.61, lonMax: -3.75, centroid: [-4.68, 36.82] },
  { prefix: 'ESAND29', name: 'Málaga',      latMin: 36.72, latMax: 37.71, lonMin: -5.39, lonMax: -4.05, centroid: [-4.72, 37.22] },
  { prefix: 'ESAND41', name: 'Sevilla',     latMin: 36.85, latMax: 38.10, lonMin: -6.55, lonMax: -4.95, centroid: [-5.75, 37.47] },
  // Aragón (ARA)
  { prefix: 'ESARA22', name: 'Huesca',      latMin: 41.36, latMax: 43.08, lonMin: -0.92, lonMax: 0.78,  centroid: [-0.07, 42.22] },
  { prefix: 'ESARA44', name: 'Teruel',      latMin: 40.04, latMax: 41.66, lonMin: -1.78, lonMax: 0.85,  centroid: [-0.46, 40.85] },
  { prefix: 'ESARA50', name: 'Zaragoza',    latMin: 40.78, latMax: 42.74, lonMin: -2.18, lonMax: 0.39,  centroid: [-0.89, 41.76] },
  // Asturias (AST)
  { prefix: 'ESAST33', name: 'Asturias',    latMin: 42.88, latMax: 43.66, lonMin: -7.18, lonMax: -4.51, centroid: [-5.85, 43.27] },
  // Cantabria (CAN)
  { prefix: 'ESCAN39', name: 'Cantabria',   latMin: 42.76, latMax: 43.51, lonMin: -8.90, lonMax: -3.65, centroid: [-3.85, 43.14] },
  // Castilla-La Mancha (CLM)
  { prefix: 'ESCLM02', name: 'Albacete',    latMin: 38.30, latMax: 39.66, lonMin: -2.81, lonMax: -0.99, centroid: [-1.86, 38.98] },
  { prefix: 'ESCLM13', name: 'Ciudad Real', latMin: 38.20, latMax: 39.65, lonMin: -4.80, lonMax: -2.64, centroid: [-3.71, 38.97] },
  { prefix: 'ESCLM16', name: 'Cuenca',      latMin: 39.30, latMax: 40.65, lonMin: -3.14, lonMax: -0.96, centroid: [-2.05, 39.97] },
  { prefix: 'ESCLM19', name: 'Guadalajara', latMin: 40.13, latMax: 41.32, lonMin: -3.48, lonMax: -1.51, centroid: [-2.50, 40.72] },
  { prefix: 'ESCLM45', name: 'Toledo',      latMin: 39.21, latMax: 40.42, lonMin: -5.41, lonMax: -2.91, centroid: [-4.16, 39.82] },
  // Castilla y León (CLE)
  { prefix: 'ESCLE05', name: 'Ávila',       latMin: 40.08, latMax: 41.18, lonMin: -6.05, lonMax: -4.49, centroid: [-5.27, 40.63] },
  { prefix: 'ESCLE09', name: 'Burgos',      latMin: 41.43, latMax: 43.20, lonMin: -4.13, lonMax: -2.49, centroid: [-3.61, 42.31] },
  { prefix: 'ESCLE24', name: 'León',        latMin: 42.08, latMax: 43.23, lonMin: -6.85, lonMax: -4.65, centroid: [-5.75, 42.66] },
  { prefix: 'ESCLE34', name: 'Palencia',    latMin: 41.77, latMax: 42.85, lonMin: -4.88, lonMax: -3.66, centroid: [-4.27, 42.31] },
  { prefix: 'ESCLE37', name: 'Salamanca',   latMin: 40.45, latMax: 41.38, lonMin: -6.94, lonMax: -5.21, centroid: [-6.07, 40.92] },
  { prefix: 'ESCLE40', name: 'Segovia',     latMin: 40.74, latMax: 41.57, lonMin: -4.62, lonMax: -3.36, centroid: [-3.99, 41.16] },
  { prefix: 'ESCLE42', name: 'Soria',       latMin: 41.09, latMax: 42.16, lonMin: -3.53, lonMax: -1.81, centroid: [-2.67, 41.63] },
  { prefix: 'ESCLE47', name: 'Valladolid',  latMin: 41.10, latMax: 42.30, lonMin: -5.50, lonMax: -3.97, centroid: [-4.74, 41.70] },
  { prefix: 'ESCLE49', name: 'Zamora',      latMin: 41.33, latMax: 42.28, lonMin: -6.50, lonMax: -5.10, centroid: [-5.80, 41.81] },
  // Catalunya (CAT)
  { prefix: 'ESCAT08', name: 'Barcelona',   latMin: 41.32, latMax: 42.32, lonMin: 1.61,  lonMax: 2.79,  centroid: [2.20, 41.82] },
  { prefix: 'ESCAT17', name: 'Girona',      latMin: 41.65, latMax: 42.46, lonMin: 2.21,  lonMax: 3.33,  centroid: [2.77, 42.05] },
  { prefix: 'ESCAT25', name: 'Lleida',      latMin: 41.32, latMax: 43.10, lonMin: 0.30,  lonMax: 1.85,  centroid: [1.08, 42.21] },
  { prefix: 'ESCAT43', name: 'Tarragona',   latMin: 40.52, latMax: 41.65, lonMin: 0.16,  lonMax: 1.55,  centroid: [0.85, 41.09] },
  // Extremadura (EXT)
  { prefix: 'ESEXT06', name: 'Badajoz',     latMin: 38.07, latMax: 39.49, lonMin: -7.52, lonMax: -4.65, centroid: [-6.08, 38.78] },
  { prefix: 'ESEXT10', name: 'Cáceres',     latMin: 39.05, latMax: 40.49, lonMin: -7.55, lonMax: -4.89, centroid: [-6.22, 39.77] },
  // Galicia (GAL)
  { prefix: 'ESGAL15', name: 'A Coruña',    latMin: 42.49, latMax: 43.99, lonMin: -9.30, lonMax: -7.70, centroid: [-8.50, 43.24] },
  { prefix: 'ESGAL27', name: 'Lugo',        latMin: 42.33, latMax: 43.99, lonMin: -8.13, lonMax: -6.77, centroid: [-7.45, 43.16] },
  { prefix: 'ESGAL32', name: 'Ourense',     latMin: 41.86, latMax: 42.58, lonMin: -8.36, lonMax: -6.94, centroid: [-7.65, 42.22] },
  { prefix: 'ESGAL36', name: 'Pontevedra',  latMin: 41.86, latMax: 42.78, lonMin: -8.95, lonMax: -7.95, centroid: [-8.45, 42.32] },
  // Islas Baleares (BAL)
  { prefix: 'ESBAL07', name: 'Mallorca',    latMin: 39.30, latMax: 40.09, lonMin: 2.32,  lonMax: 3.50,  centroid: [2.91, 39.70] },
  { prefix: 'ESBAL07', name: 'Menorca',     latMin: 39.80, latMax: 40.09, lonMin: 3.85,  lonMax: 4.33,  centroid: [4.09, 39.95] },
  { prefix: 'ESBAL07', name: 'Ibiza',       latMin: 38.78, latMax: 39.20, lonMin: 1.18,  lonMax: 1.62,  centroid: [1.40, 38.99] },
  // Canarias (CAN)
  { prefix: 'ESCAN35', name: 'Las Palmas',  latMin: 27.74, latMax: 29.43, lonMin: -15.65, lonMax: -13.35, centroid: [-14.50, 28.59] },
  { prefix: 'ESCAN38', name: 'S/C Tenerife', latMin: 27.73, latMax: 28.74, lonMin: -18.23, lonMax: -16.10, centroid: [-17.16, 28.24] },
  // La Rioja (RIO)
  { prefix: 'ESRIO26', name: 'La Rioja',    latMin: 42.05, latMax: 42.65, lonMin: -3.13, lonMax: -1.67, centroid: [-2.40, 42.35] },
  // Madrid (MAD)
  { prefix: 'ESMAD28', name: 'Madrid',      latMin: 40.04, latMax: 41.16, lonMin: -4.57, lonMax: -3.04, centroid: [-3.81, 40.60] },
  // Murcia (MUR)
  { prefix: 'ESMUR30', name: 'Murcia',      latMin: 37.39, latMax: 38.83, lonMin: -2.34, lonMax: -0.65, centroid: [-1.50, 38.11] },
  // Navarra (NAV)
  { prefix: 'ESNAV31', name: 'Navarra',     latMin: 41.91, latMax: 43.31, lonMin: -2.50, lonMax: -0.72, centroid: [-1.61, 42.61] },
  // País Vasco (PVA)
  { prefix: 'ESPVA01', name: 'Álava',       latMin: 42.45, latMax: 43.20, lonMin: -3.10, lonMax: -2.20, centroid: [-2.65, 42.83] },
  { prefix: 'ESPVA20', name: 'Gipuzkoa',    latMin: 42.91, latMax: 43.40, lonMin: -2.60, lonMax: -1.73, centroid: [-2.16, 43.15] },
  { prefix: 'ESPVA48', name: 'Bizkaia',     latMin: 43.05, latMax: 43.45, lonMin: -3.45, lonMax: -2.41, centroid: [-2.93, 43.25] },
  // Comunidad Valenciana (PVA — same trigram as País Vasco in Meteoclimatic)
  { prefix: 'ESPVA03', name: 'Alicante',    latMin: 38.09, latMax: 38.96, lonMin: -1.04, lonMax: 0.86,  centroid: [-0.55, 38.52] },
  { prefix: 'ESPVA12', name: 'Castellón',   latMin: 39.75, latMax: 40.81, lonMin: -0.87, lonMax: 0.78,  centroid: [-0.04, 40.28] },
  { prefix: 'ESPVA46', name: 'Valencia',    latMin: 38.64, latMax: 40.20, lonMin: -1.55, lonMax: 0.36,  centroid: [-0.61, 39.42] },
]

/**
 * Resolve a Meteoclimatic province prefix from a (lat, lon) pair.
 * Returns null if the point is outside Spain.
 *
 * Algorithm:
 * 1. Filter provinces whose bbox contains the point.
 * 2. If exactly one → return its prefix.
 * 3. If several (bboxes overlap on borders) → pick the one whose
 *    centroid is closest to the point.
 * 4. If none → if the point is within 100 km of any centroid, pick
 *    the closest one (handles coastal / just-offshore points whose bbox
 *    misses them but the nearest province is unambiguous).
 * 5. Otherwise → null.
 */
export function resolveMeteoclimaticPrefix(lat: number, lon: number): string | null {
  const inside = PROVINCES.filter(
    p => lat >= p.latMin && lat <= p.latMax && lon >= p.lonMin && lon <= p.lonMax
  )
  if (inside.length === 1) return inside[0].prefix
  if (inside.length > 1) {
    // Pick by centroid proximity.
    const best = inside.reduce((acc, p) => {
      const d = haversineSq(lat, lon, p.centroid[1], p.centroid[0])
      return d < acc.d ? { p, d } : acc
    }, { p: inside[0], d: Infinity })
    return best.p.prefix
  }
  // Fallback: nearest centroid within 100 km. haversineSq avoids
  // importing the geoDistance module here, which would create a cycle
  // through station filter chains.
  const ALL_LIMIT_KM = 100
  const allLimitSq = (ALL_LIMIT_KM / 111) ** 2 // rough deg² for a 100 km cutoff
  let nearest: MeteoclimaticProvince | null = null
  let nearestD2 = Infinity
  for (const p of PROVINCES) {
    const d2 = haversineSq(lat, lon, p.centroid[1], p.centroid[0])
    if (d2 < nearestD2) {
      nearestD2 = d2
      nearest = p
    }
  }
  if (nearest && nearestD2 < allLimitSq) return nearest.prefix
  return null
}

function haversineSq(lat1: number, lon1: number, lat2: number, lon2: number): number {
  // Squared angular distance, sufficient for "nearest" comparisons.
  // Output is in deg² (very rough at high latitudes, but only used to
  // pick the nearest of ~52 candidates).
  const dLat = lat1 - lat2
  const dLon = lon1 - lon2
  return dLat * dLat + dLon * dLon
}

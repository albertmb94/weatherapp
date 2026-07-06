/**
 * Backtesting configuration: reference locations, metrics, and models
 * used to evaluate forecast accuracy across different terrain types.
 */

export type TerrainType = 'coastal' | 'mountain' | 'urban' | 'flat' | 'island' | 'river_valley'

export interface BacktestLocation {
  name: string
  lat: number
  lon: number
  terrain: TerrainType
  country: string
}

/** 100 reference locations across Europe, N. America, and Spain */
export const BACKTEST_LOCATIONS: BacktestLocation[] = [
  // === Spain (20) ===
  { name: 'Barcelona', lat: 41.39, lon: 2.17, terrain: 'coastal', country: 'ES' },
  { name: 'Madrid', lat: 40.42, lon: -3.70, terrain: 'urban', country: 'ES' },
  { name: 'Valencia', lat: 39.47, lon: -0.38, terrain: 'coastal', country: 'ES' },
  { name: 'Sevilla', lat: 37.39, lon: -6.00, terrain: 'river_valley', country: 'ES' },
  { name: 'Málaga', lat: 36.72, lon: -4.42, terrain: 'coastal', country: 'ES' },
  { name: 'Bilbao', lat: 43.26, lon: -2.93, terrain: 'coastal', country: 'ES' },
  { name: 'Zaragoza', lat: 41.65, lon: -0.88, terrain: 'flat', country: 'ES' },
  { name: 'Palma', lat: 39.57, lon: 2.65, terrain: 'island', country: 'ES' },
  { name: 'Granada', lat: 37.18, lon: -3.60, terrain: 'mountain', country: 'ES' },
  { name: 'Alicante', lat: 38.35, lon: -0.49, terrain: 'coastal', country: 'ES' },
  { name: 'Córdoba', lat: 37.88, lon: -4.77, terrain: 'river_valley', country: 'ES' },
  { name: 'Valladolid', lat: 41.65, lon: -4.72, terrain: 'flat', country: 'ES' },
  { name: 'Vigo', lat: 42.24, lon: -8.72, terrain: 'coastal', country: 'ES' },
  { name: 'Gijón', lat: 43.54, lon: -5.66, terrain: 'coastal', country: 'ES' },
  { name: 'Las Palmas', lat: 28.10, lon: -15.41, terrain: 'island', country: 'ES' },
  { name: 'Tenerife', lat: 28.04, lon: -16.57, terrain: 'island', country: 'ES' },
  { name: 'Murcia', lat: 37.99, lon: -1.13, terrain: 'flat', country: 'ES' },
  { name: 'Salamanca', lat: 40.97, lon: -5.66, terrain: 'flat', country: 'ES' },
  { name: 'San Sebastián', lat: 43.32, lon: -1.98, terrain: 'coastal', country: 'ES' },
  { name: 'Cuenca', lat: 40.07, lon: -2.13, terrain: 'mountain', country: 'ES' },

  // === Europe (40) ===
  { name: 'Paris', lat: 48.86, lon: 2.35, terrain: 'urban', country: 'FR' },
  { name: 'Lyon', lat: 45.76, lon: 4.84, terrain: 'river_valley', country: 'FR' },
  { name: 'Marseille', lat: 43.30, lon: 5.37, terrain: 'coastal', country: 'FR' },
  { name: 'Toulouse', lat: 43.60, lon: 1.44, terrain: 'flat', country: 'FR' },
  { name: 'London', lat: 51.51, lon: -0.13, terrain: 'urban', country: 'GB' },
  { name: 'Edinburgh', lat: 55.95, lon: -3.19, terrain: 'urban', country: 'GB' },
  { name: 'Berlin', lat: 52.52, lon: 13.41, terrain: 'urban', country: 'DE' },
  { name: 'Munich', lat: 48.14, lon: 11.58, terrain: 'flat', country: 'DE' },
  { name: 'Hamburg', lat: 53.55, lon: 10.00, terrain: 'flat', country: 'DE' },
  { name: 'Rome', lat: 41.90, lon: 12.50, terrain: 'urban', country: 'IT' },
  { name: 'Milan', lat: 45.46, lon: 9.19, terrain: 'flat', country: 'IT' },
  { name: 'Naples', lat: 40.85, lon: 14.27, terrain: 'coastal', country: 'IT' },
  { name: 'Amsterdam', lat: 52.37, lon: 4.90, terrain: 'flat', country: 'NL' },
  { name: 'Brussels', lat: 50.85, lon: 4.35, terrain: 'flat', country: 'BE' },
  { name: 'Vienna', lat: 48.21, lon: 16.37, terrain: 'river_valley', country: 'AT' },
  { name: 'Prague', lat: 50.08, lon: 14.44, terrain: 'river_valley', country: 'CZ' },
  { name: 'Warsaw', lat: 52.23, lon: 21.01, terrain: 'flat', country: 'PL' },
  { name: 'Copenhagen', lat: 55.68, lon: 12.57, terrain: 'coastal', country: 'DK' },
  { name: 'Stockholm', lat: 59.33, lon: 18.07, terrain: 'coastal', country: 'SE' },
  { name: 'Oslo', lat: 59.91, lon: 10.75, terrain: 'coastal', country: 'NO' },
  { name: 'Helsinki', lat: 60.17, lon: 24.94, terrain: 'coastal', country: 'FI' },
  { name: 'Lisbon', lat: 38.72, lon: -9.14, terrain: 'coastal', country: 'PT' },
  { name: 'Porto', lat: 41.15, lon: -8.61, terrain: 'coastal', country: 'PT' },
  { name: 'Athens', lat: 37.98, lon: 23.73, terrain: 'coastal', country: 'GR' },
  { name: 'Zurich', lat: 47.38, lon: 8.54, terrain: 'flat', country: 'CH' },
  { name: 'Geneva', lat: 46.20, lon: 6.14, terrain: 'flat', country: 'CH' },
  { name: 'Dublin', lat: 53.35, lon: -6.26, terrain: 'coastal', country: 'IE' },
  { name: 'Reykjavik', lat: 64.15, lon: -21.94, terrain: 'coastal', country: 'IS' },
  { name: 'Ankara', lat: 39.93, lon: 32.86, terrain: 'flat', country: 'TR' },
  { name: 'Bucharest', lat: 44.43, lon: 26.10, terrain: 'flat', country: 'RO' },

  // === N. America (40) ===
  { name: 'New York', lat: 40.71, lon: -74.01, terrain: 'urban', country: 'US' },
  { name: 'Los Angeles', lat: 34.05, lon: -118.24, terrain: 'coastal', country: 'US' },
  { name: 'Chicago', lat: 41.88, lon: -87.63, terrain: 'urban', country: 'US' },
  { name: 'Houston', lat: 29.76, lon: -95.37, terrain: 'coastal', country: 'US' },
  { name: 'Phoenix', lat: 33.45, lon: -112.07, terrain: 'flat', country: 'US' },
  { name: 'San Francisco', lat: 37.77, lon: -122.42, terrain: 'coastal', country: 'US' },
  { name: 'Miami', lat: 25.76, lon: -80.19, terrain: 'coastal', country: 'US' },
  { name: 'Seattle', lat: 47.61, lon: -122.33, terrain: 'coastal', country: 'US' },
  { name: 'Denver', lat: 39.74, lon: -104.99, terrain: 'mountain', country: 'US' },
  { name: 'Boston', lat: 42.36, lon: -71.06, terrain: 'coastal', country: 'US' },
  { name: 'Atlanta', lat: 33.75, lon: -84.39, terrain: 'flat', country: 'US' },
  { name: 'Dallas', lat: 32.78, lon: -96.80, terrain: 'flat', country: 'US' },
  { name: 'Minneapolis', lat: 44.98, lon: -93.27, terrain: 'flat', country: 'US' },
  { name: 'Portland', lat: 45.52, lon: -122.68, terrain: 'river_valley', country: 'US' },
  { name: 'Las Vegas', lat: 36.17, lon: -115.14, terrain: 'flat', country: 'US' },
  { name: 'Nashville', lat: 36.16, lon: -86.78, terrain: 'flat', country: 'US' },
  { name: 'Austin', lat: 30.27, lon: -97.74, terrain: 'river_valley', country: 'US' },
  { name: 'Detroit', lat: 42.33, lon: -83.05, terrain: 'urban', country: 'US' },
  { name: 'Toronto', lat: 43.65, lon: -79.38, terrain: 'urban', country: 'CA' },
  { name: 'Vancouver', lat: 49.28, lon: -123.12, terrain: 'coastal', country: 'CA' },
  { name: 'Montreal', lat: 45.50, lon: -73.57, terrain: 'river_valley', country: 'CA' },
  { name: 'Calgary', lat: 51.05, lon: -114.07, terrain: 'flat', country: 'CA' },
  { name: 'Ottawa', lat: 45.42, lon: -75.70, terrain: 'river_valley', country: 'CA' },
  { name: 'Edmonton', lat: 53.55, lon: -113.49, terrain: 'flat', country: 'CA' },
  { name: 'Mexico City', lat: 19.43, lon: -99.13, terrain: 'mountain', country: 'MX' },
  { name: 'Guadalajara', lat: 20.67, lon: -103.35, terrain: 'flat', country: 'MX' },
  { name: 'Monterrey', lat: 25.69, lon: -100.32, terrain: 'mountain', country: 'MX' },
  { name: 'Cancún', lat: 21.16, lon: -86.85, terrain: 'coastal', country: 'MX' },
  { name: 'Havana', lat: 23.11, lon: -82.37, terrain: 'coastal', country: 'CU' },
  { name: 'San Juan', lat: 18.47, lon: -66.11, terrain: 'island', country: 'PR' },
  { name: 'Santo Domingo', lat: 18.49, lon: -69.93, terrain: 'coastal', country: 'DO' },
  { name: 'San José', lat: 9.93, lon: -84.08, terrain: 'mountain', country: 'CR' },
  { name: 'Panama City', lat: 8.98, lon: -79.52, terrain: 'coastal', country: 'PA' },
  { name: 'Guatemala City', lat: 14.63, lon: -90.51, terrain: 'mountain', country: 'GT' },
  { name: 'Lima', lat: -12.05, lon: -77.04, terrain: 'coastal', country: 'PE' },
  { name: 'Bogotá', lat: 4.71, lon: -74.07, terrain: 'mountain', country: 'CO' },
  { name: 'Santiago', lat: -33.45, lon: -70.67, terrain: 'mountain', country: 'CL' },
  { name: 'Buenos Aires', lat: -34.60, lon: -58.38, terrain: 'river_valley', country: 'AR' },
  { name: 'São Paulo', lat: -23.55, lon: -46.63, terrain: 'flat', country: 'BR' },
  { name: 'Rio de Janeiro', lat: -22.91, lon: -43.17, terrain: 'coastal', country: 'BR' },
]

/** Metrics to verify during backtesting */
export const BACKTEST_METRICS = ['temperature', 'wind_speed', 'precipitation'] as const

/** Lead time buckets for verification */
export const LEAD_TIME_BUCKETS = ['0-24h', '24-48h', '48-72h', '72-96h', '96-120h', '120-168h'] as const

/** Models to evaluate (subset of all models — only those with good coverage) */
export const BACKTEST_MODEL_IDS = [
  'ecmwf_ifs',
  'icon_global',
  'gfs_global',
  'ecmwf_aifs025',
  'gfs_graphcast',
  'ncep_aigfs',
  'icon_eu',
  'meteofrance_arpege_europe',
  'gem_global',
] as const

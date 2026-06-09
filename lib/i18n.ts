export type Locale = 'es' | 'en'

export const LOCALE_STORAGE_KEY = 'weather-locale'

export const DAY_NAMES: Record<Locale, string[]> = {
  es: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

export const STRINGS: Record<Locale, {
  today: string
  tomorrow: string
  tableWhen: string
  tableCond: string
  tableTemp: string
  tableMin: string
  tableMax: string
  tableClouds: string
  tableWind: string
  tableGusts: string
  tablePrecip: string
  tableHumidity: string
  tableUv: string
  tablePressure: string
  tableDewpoint: string
  tableVisibility: string
  tableWaveHeight: string
  tableWavePeriod: string
  tableWaveDirection: string
  tableWindWaveHeight: string
  tableWindWavePeriod: string
  tableSwellHeight: string
  tableSwellPeriod: string
  dailyTitle: string
  insightsTitle: string
  loadingForecast: string
  errorForecast: string
  heatmapLoading: string
  heatmapNoData: string
  radarLoading: string
  btnNow: string
  btnPrevHour: string
  btnNextHour: string
  btnPrevDay: string
  btnNextDay: string
  footerHours: string
  footerSearch: string
  footerMap: string
  cityCoords: string
  noMarineData: string
  saveError: string
  loadingStations: string
  noResults: string
  noStationsRegion: string
  stationError: string
  retry: string
  searchPlaceholder: string
  humidity: string
  wind: string
  pressure: string
  precipitation: string
}> = {
  es: {
    today: 'Hoy',
    tomorrow: 'Mañ',
    tableWhen: 'Cuándo',
    tableCond: 'Cond',
    tableTemp: 'Temp °C',
    tableMin: 'Min',
    tableMax: 'Max',
    tableClouds: 'Nubes %',
    tableWind: 'Viento km/h',
    tableGusts: 'Rachas',
    tablePrecip: 'Lluvia mm',
    tableHumidity: 'Humedad %',
    tableUv: 'UV',
    tablePressure: 'Pres hPa',
    tableDewpoint: 'Rocío °C',
    tableVisibility: 'Vis km',
    tableWaveHeight: 'Ola m',
    tableWavePeriod: 'Periodo s',
    tableWaveDirection: 'Dir ola',
    tableWindWaveHeight: 'Ola vient m',
    tableWindWavePeriod: 'Periodo vient s',
    tableSwellHeight: 'Swell m',
    tableSwellPeriod: 'Swell s',
    dailyTitle: 'Resumen diario (ensemble)',
    insightsTitle: 'Insights',
    loadingForecast: 'Cargando previsión…',
    errorForecast: 'Error al cargar la previsión. Inténtalo de nuevo.',
    heatmapLoading: 'Cargando mapa de calor…',
    heatmapNoData: 'Sin datos de mapa de calor',
    radarLoading: 'Cargando radar…',
    btnNow: 'Ahora',
    btnPrevHour: '−1h',
    btnNextHour: '+1h',
    btnPrevDay: '−24h',
    btnNextDay: '+24h',
    footerHours: '← → horas',
    footerSearch: '/ buscar',
    footerMap: 'm mapa',
    cityCoords: '{city} · {lat}, {lon}',
    noMarineData: 'Sin datos marinos en esta ubicación',
    saveError: 'Error al guardar',
    loadingStations: 'Cargando...',
    noResults: 'Sin resultados para',
    noStationsRegion: 'Sin estaciones en esta región',
    stationError: 'Error al cargar estaciones',
    retry: 'Reintentar',
    searchPlaceholder: 'Buscar...',
    humidity: 'Humedad',
    wind: 'Viento',
    pressure: 'Presión',
    precipitation: 'Precip',
  },
  en: {
    today: 'Today',
    tomorrow: 'Tmrw',
    tableWhen: 'When',
    tableCond: 'Cond',
    tableTemp: 'Temp °C',
    tableMin: 'Min',
    tableMax: 'Max',
    tableClouds: 'Clouds %',
    tableWind: 'Wind km/h',
    tableGusts: 'Gusts',
    tablePrecip: 'Rain mm',
    tableHumidity: 'Humidity %',
    tableUv: 'UV',
    tablePressure: 'Pres hPa',
    tableDewpoint: 'Dew °C',
    tableVisibility: 'Vis km',
    tableWaveHeight: 'Wave m',
    tableWavePeriod: 'Period s',
    tableWaveDirection: 'Wave dir',
    tableWindWaveHeight: 'Wind wave m',
    tableWindWavePeriod: 'Wind wave s',
    tableSwellHeight: 'Swell m',
    tableSwellPeriod: 'Swell s',
    dailyTitle: 'Daily summary (ensemble)',
    insightsTitle: 'Insights',
    loadingForecast: 'Loading forecast…',
    errorForecast: 'Error loading forecast. Please try again.',
    heatmapLoading: 'Loading heatmap…',
    heatmapNoData: 'No heatmap data',
    radarLoading: 'Loading radar…',
    btnNow: 'Now',
    btnPrevHour: '−1h',
    btnNextHour: '+1h',
    btnPrevDay: '−24h',
    btnNextDay: '+24h',
    footerHours: '← → hours',
    footerSearch: '/ search',
    footerMap: 'm map',
    cityCoords: '{city} · {lat}, {lon}',
    noMarineData: 'No marine data at this location',
    saveError: 'Save failed',
    loadingStations: 'Loading...',
    noResults: 'No results for',
    noStationsRegion: 'No stations in this region',
    stationError: 'Error loading stations',
    retry: 'Retry',
    searchPlaceholder: 'Search...',
    humidity: 'Humidity',
    wind: 'Wind',
    pressure: 'Pressure',
    precipitation: 'Precip',
  },
}

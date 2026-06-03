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
  },
}

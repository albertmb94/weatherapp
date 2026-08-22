export type Locale = 'es' | 'en'

export const LOCALE_STORAGE_KEY = 'weather-locale'

export const DAY_NAMES: Record<Locale, string[]> = {
  es: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

export const CONDITION_LABEL: Record<Locale, Record<string, string>> = {
  es: {
    sunny: 'Soleado',
    partly: 'Parcialmente nublado',
    cloudy: 'Nublado',
    rainy: 'Lluvioso',
    stormy: 'Tormenta',
    snowy: 'Nieve',
  },
  en: {
    sunny: 'Sunny',
    partly: 'Partly cloudy',
    cloudy: 'Cloudy',
    rainy: 'Rainy',
    stormy: 'Storm',
    snowy: 'Snow',
  },
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
  tableSeaTemp: string
  tableWaveHeight: string
  tableWavePeriod: string
  tableWaveDirection: string
  tableWindWaveHeight: string
  tableWindWavePeriod: string
  tableSwellHeight: string
  tableSwellPeriod: string
  dailyTitle: string
  insightsTitle: string
  insightsShowNext: string
  insightsRowsRemaining: string
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
  groupView: string
  groupLayers: string
  groupData: string
  groupActions: string
  map: string
  radar: string
  marine: string
  basic: string
  save: string
  csv: string
  share: string
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
  nearLabel: string
  radiusLabel: string
  noStationsRadius: string
  expandRadius: string
  offlineBanner: string
  lastSeen: string
  searchPlaceholderCity: string
  realFeel: string
  chanceOfRain: string
  uvIndex: string
  uvPeak: string
  uvModeLive: string
  uvModePeak: string
  windSpeed: string
  windGusts: string
  dailyHigh: string
  dailyLow: string
  precipTotal: string
  hourlyTitle: string
  /** B-NBT-9b: badge shown on the headline card when the temperature
   *  comes from the nearby-station nowcast blend instead of the pure
   *  ensemble. */
  liveStationBadge: string
  /** B-NBT-10: reserved ad inventory label (free tier). */
  adPlaceholder: string
  metricsTitle: string
  weekTitle: string
  weekOption7: string
  weekOption14: string
  chanceLabel: string
  conditionSunny: string
  conditionPartly: string
  conditionCloudy: string
  conditionRainy: string
  conditionStormy: string
  conditionSnowy: string
  navWeather: string
  navCities: string
  navMap: string
  navStations: string
  navSettings: string
  /** F5 (revised): the air-quality card title in the section
   *  above the Métricas block. The full set of tiles lives
   *  there on desktop; on mobile the user sees only the EU
   *  AQI badge inside Métricas (see `airQualityMetricLabel`). */
  airQualityTitle: string
  /** F5 (revised): the label rendered inside the Métricas
   *  card on every viewport — the EU AQI value + band. */
  airQualityMetricLabel: string
  navAdvanced: string
  settingsTitle: string
  settingsLanguage: string
  settingsTheme: string
  settingsSaveLocation: string
  settingsExport: string
  settingsShare: string
  navAria: string
  layersTitle: string
  citiesEmpty: string
  citiesEmptyHint: string
  citiesSaveCurrent: string
  citiesSaved: string
  noUnits: string
  confidenceHigh: string
  confidenceMedium: string
  confidenceLow: string
  confidenceTooltip: string
  spreadLabel: string
  spreadSuffix: string
  rainProbCalibrated: string
  rainIntensity: string
  rainTotalDay: string
  modelAccuracyTitle: string
  accuracyType: string
  accuracyMAE: string
  accuracyRMSE: string
  accuracyBias: string
  accuracySamples: string
  accuracyNote: string
  noAccuracyData: string
  methodologyTitle: string
  methodologyDescription: string
  nowcastTitle: string
  nowcastExplanation: string
  nowcastObs: string
  nowcastFcst: string
  profileCoastal: string
  profileMountain: string
  profileUrban: string
  profileAgricultural: string
  profileSailing: string
  profilePlain: string
  /** Sprint 13: small badge rendered inside FriendlyHome next to
   * the "Tiempo actual" card. The first segment is the literal
   * label (e.g. "Perfil:"); the second is the trailing text the
   * chip shows when the auto-derived profile did NOT bias the
   * ensemble (e.g. plain profile or empty backtest). */
  profileChipPrefix: string
  profileChipNeutral: string
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
    tableSeaTemp: 'Mar °C',
    tableWaveHeight: 'Ola m',
    tableWavePeriod: 'Periodo s',
    tableWaveDirection: 'Dir ola',
    tableWindWaveHeight: 'Ola vient m',
    tableWindWavePeriod: 'Periodo vient s',
    tableSwellHeight: 'Swell m',
    tableSwellPeriod: 'Swell s',
    dailyTitle: 'Resumen diario',
    insightsTitle: 'Insights',
    insightsShowNext: '+ Mostrar siguientes {n} h',
    insightsRowsRemaining: '({n} filas restantes)',
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
    groupView: 'Vista',
    groupLayers: 'Capas',
    groupData: 'Datos',
    groupActions: 'Acciones',
    map: 'Mapa',
    radar: 'Radar',
    marine: 'Marine',
    basic: 'Basic',
    save: 'Guardar',
    csv: 'CSV',
    share: 'Compartir',
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
    nearLabel: 'Cerca de',
    radiusLabel: 'Radio de búsqueda',
    noStationsRadius: 'No hay estaciones a menos de {km} km',
    expandRadius: 'Ampliar a {km} km',
    offlineBanner: 'Sin conexión',
    lastSeen: 'última actualización',
    searchPlaceholderCity: 'Buscar ciudades',
    realFeel: 'Sensación',
    chanceOfRain: 'Prob. lluvia',
    uvIndex: 'Índice UV',
    uvPeak: 'Pico UV hoy',
    uvModeLive: 'En vivo',
    uvModePeak: 'Pico',
    windSpeed: 'Viento',
    windGusts: 'Rachas',
    dailyHigh: 'Máx',
    dailyLow: 'Mín',
    precipTotal: 'Lluvia',
    hourlyTitle: 'Previsión de hoy',
    liveStationBadge: 'en vivo · estación cercana',
    adPlaceholder: 'Publicidad',
    metricsTitle: 'Métricas',
    weekTitle: 'Próximos días',
    weekOption7: '7 días',
    weekOption14: '14 días',
    chanceLabel: 'Probabilidad de lluvia:',
    airQualityTitle: 'Calidad del aire',
    airQualityMetricLabel: 'Calidad del aire',
    conditionSunny: 'Soleado',
    conditionPartly: 'Parcialmente nublado',
    conditionCloudy: 'Nublado',
    conditionRainy: 'Lluvioso',
    conditionStormy: 'Tormenta',
    conditionSnowy: 'Nieve',
    navWeather: 'Tiempo',
    navCities: 'Ciudades',
    navMap: 'Mapa',
    navStations: 'Estaciones',
    navSettings: 'Ajustes',
    navAdvanced: 'Avanzado',
    settingsTitle: 'Ajustes',
    settingsLanguage: 'Idioma',
    settingsTheme: 'Tema',
    settingsSaveLocation: 'Guardar ubicación',
    settingsExport: 'Exportar CSV',
    settingsShare: 'Compartir enlace',
    navAria: 'Navegación principal',
    layersTitle: 'Capas',
    citiesEmpty: 'Aún no hay ciudades guardadas',
    citiesEmptyHint: 'Pulsa “Guardar ciudad” para añadir la ubicación actual.',
    citiesSaveCurrent: 'Guardar ciudad',
    citiesSaved: 'Guardado',
    noUnits: 'N/A',
    confidenceHigh: 'Alta',
    confidenceMedium: 'Media',
    confidenceLow: 'Baja',
    confidenceTooltip: 'Confianza del ensemble basada en la concordancia entre modelos',
    spreadLabel: '±',
    spreadSuffix: '° de dispersión',
    rainProbCalibrated: 'Probabilidad calibrada (ensemble)',
    rainIntensity: 'Intensidad (mm/h)',
    rainTotalDay: 'Total hoy',
    modelAccuracyTitle: 'Precisión por modelo',
    accuracyType: 'Tipo',
    accuracyMAE: 'MAE',
    accuracyRMSE: 'RMSE',
    accuracyBias: 'Bias',
    accuracySamples: 'N',
    accuracyNote: 'Métricas calculadas contra ERA5 reanalysis. Menor RMSE = mayor precisión.',
    noAccuracyData: 'Sin datos de precisión disponibles. Los datos se actualizarán tras el primer backtest semanal.',
    methodologyTitle: 'Metodología',
    methodologyDescription: 'El ensemble pondera dinámicamente los modelos basándose en su precisión histórica para la ubicación y el tipo de terreno actual.',
    nowcastTitle: 'Nowcast',
    nowcastExplanation: 'Mezcla la última lectura de la estación más cercana con la primera hora del ensemble para los minutos iniciales.',
    nowcastObs: 'Estación',
    nowcastFcst: 'Ensemble',
    profileCoastal: 'Costa',
    profileMountain: 'Montaña',
    profileUrban: 'Ciudad',
    profileAgricultural: 'Agricultura',
    profileSailing: 'Navegación',
    profilePlain: 'Llanura',
    profileChipPrefix: 'Perfil',
    profileChipNeutral: 'Sin sesgo regional',
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
    tableSeaTemp: 'Sea °C',
    tableWaveHeight: 'Wave m',
    tableWavePeriod: 'Period s',
    tableWaveDirection: 'Wave dir',
    tableWindWaveHeight: 'Wind wave m',
    tableWindWavePeriod: 'Wind wave s',
    tableSwellHeight: 'Swell m',
    tableSwellPeriod: 'Swell s',
    dailyTitle: 'Daily summary',
    insightsTitle: 'Insights',
    insightsShowNext: '+ Show next {n} h',
    insightsRowsRemaining: '({n} rows remaining)',
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
    groupView: 'View',
    groupLayers: 'Layers',
    groupData: 'Data',
    groupActions: 'Actions',
    map: 'Map',
    radar: 'Radar',
    marine: 'Marine',
    basic: 'Basic',
    save: 'Save',
    csv: 'CSV',
    share: 'Share',
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
    nearLabel: 'Near',
    radiusLabel: 'Search radius',
    noStationsRadius: 'No stations within {km} km',
    expandRadius: 'Widen to {km} km',
    offlineBanner: 'Offline',
    lastSeen: 'last seen',
    searchPlaceholderCity: 'Search for cities',
    realFeel: 'Real Feel',
    chanceOfRain: 'Chance of rain',
    uvIndex: 'UV Index',
    uvPeak: 'UV peak',
    uvModeLive: 'Live',
    uvModePeak: 'Peak',
    windSpeed: 'Wind',
    windGusts: 'Gusts',
    dailyHigh: 'High',
    dailyLow: 'Low',
    precipTotal: 'Rain',
    hourlyTitle: "Today’s forecast",
    liveStationBadge: 'live · nearby station',
    adPlaceholder: 'Advertisement',
    metricsTitle: 'Metrics',
    weekTitle: 'Upcoming days',
    weekOption7: '7 days',
    weekOption14: '14 days',
    chanceLabel: 'Chance of rain:',
    airQualityTitle: 'Air quality',
    airQualityMetricLabel: 'Air quality',
    conditionSunny: 'Sunny',
    conditionPartly: 'Partly cloudy',
    conditionCloudy: 'Cloudy',
    conditionRainy: 'Rainy',
    conditionStormy: 'Storm',
    conditionSnowy: 'Snow',
    navWeather: 'Weather',
    navCities: 'Cities',
    navMap: 'Map',
    navStations: 'Stations',
    navSettings: 'Settings',
    navAdvanced: 'Advanced',
    settingsTitle: 'Settings',
    settingsLanguage: 'Language',
    settingsTheme: 'Theme',
    settingsSaveLocation: 'Save location',
    settingsExport: 'Export CSV',
    settingsShare: 'Share link',
    navAria: 'Primary navigation',
    layersTitle: 'Layers',
    citiesEmpty: 'No saved cities yet',
    citiesEmptyHint: 'Tap “Save city” to bookmark the current location.',
    citiesSaveCurrent: 'Save city',
    citiesSaved: 'Saved',
    noUnits: 'N/A',
    confidenceHigh: 'High',
    confidenceMedium: 'Medium',
    confidenceLow: 'Low',
    confidenceTooltip: 'Ensemble confidence based on model agreement',
    spreadLabel: '±',
    spreadSuffix: '° spread',
    rainProbCalibrated: 'Calibrated rain probability (ensemble)',
    rainIntensity: 'Intensity (mm/h)',
    rainTotalDay: 'Today total',
    modelAccuracyTitle: 'Model accuracy',
    accuracyType: 'Type',
    accuracyMAE: 'MAE',
    accuracyRMSE: 'RMSE',
    accuracyBias: 'Bias',
    accuracySamples: 'N',
    accuracyNote: 'Metrics computed against ERA5 reanalysis. Lower RMSE = higher accuracy.',
    noAccuracyData: 'No accuracy data available yet. Data updates after the first weekly backtest.',
    methodologyTitle: 'Methodology',
    methodologyDescription: 'The ensemble dynamically weights models based on their historical accuracy for the current location and terrain type.',
    nowcastTitle: 'Nowcast',
    nowcastExplanation: 'Blends the closest station reading with the first hour of the ensemble for the opening minutes.',
    nowcastObs: 'Station',
    nowcastFcst: 'Ensemble',
    profileCoastal: 'Coastal',
    profileMountain: 'Mountain',
    profileUrban: 'Urban',
    profileAgricultural: 'Agricultural',
    profileSailing: 'Sailing',
    profilePlain: 'Plain',
    profileChipPrefix: 'Profile',
    profileChipNeutral: 'No regional bias',
  },
}

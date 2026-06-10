# PLAN.md — Weather Model Comparison

## 1. Contexto y objetivo

**Weather** es una aplicación web que permite comparar múltiples modelos meteorológicos (AROME, HARMONIE, ICON, GFS, GDPS, etc.) de forma visual e intuitiva. El usuario selecciona una ubicación en el mapa o busca una ciudad, elige los modelos que quiere comparar y visualiza los datos en un gráfico de área, mapa de calor y tabla de insights.

**Problema que resuelve:** Los meteorólogos y aficionados necesitan comparar predicciones de diferentes modelos para evaluar incertidumbre. Actualmente deben consultar múltiples fuentes separadas.

**Usuario objetivo:** Meteorólogos aficionados y profesionales, investigadores climáticos.

---

## 2. Alcance

### In scope (MVP)
- Selección de ubicación por mapa (Leaflet) o búsqueda de ciudad (geocodificación Open-Meteo)
- Comparación de hasta 9 modelos meteorológicos simultáneos
- 7 métricas terrestres: temperatura, nubosidad, velocidad viento, ráfagas, precipitación, humedad, índice UV (más presión, rocío y visibilidad como secundarias)
- 7 métricas marinas (toggle manual): altura de ola, periodo, dirección, viento oleaje, swell
- Mapa de calor interpolado en grid 6×8 sobre la ubicación seleccionada
- Overlay de radar de lluvia en tiempo real (RainViewer)
- Gráfico comparativo con área de spread y media ponderada
- Tabla de insights con buckets temporales configurables (columnas marinas visibles solo con el toggle)
- Ubicaciones guardadas persistidas en SQLite local
- Caché de forecasts en SQLite (TTL 4h), con tabla independiente para marine
- i18n español/inglés
- Estado sincronizado en URL para compartir (incluye flag `marine`)

### Out of scope
- Autenticación de usuarios
- Datos históricos/archivados
- Alertas meteorológicas
- Predicción de más de 14 días
- Edición de coordenadas de ubicación guardada
- Exportación de datos

---

## 3. Arquitectura

### Capas y stack

| Capa | Tecnología | Versión | Justificación |
|------|------------|---------|---------------|
| Framework | Next.js | 16.2.6 | App Router, Server Components, API Routes |
| UI | React | 19.2.4 | Components, hooks |
| Styling | Tailwind CSS | 4 | Utility-first, @tailwindcss/postcss |
| Mapas | Leaflet + react-leaflet | 1.9.4 / 5.0.0 | Mapa interactivo ligero |
| Gráficos | Recharts | 3.8.1 | Componentes React para gráficos |
| Estado servidor | TanStack Query | 5.100.10 | Fetch, caché, invalidación |
| DB local | libSQL (Turso) | 0.17.3 | SQLite embebido para caché y ubicaciones |
| HTTP client | fetch nativo | — | API routes |
| Marine data | Open-Meteo Marine API | — | `marine-api.open-meteo.com`, sin desglose por modelo |
| i18n | Context API + JSON | — | LocaleContext custom |

### Estructura de carpetas

```
weather/
├── app/
│   ├── api/
│   │   ├── forecast/route.ts      # Proxy Open-Meteo forecast con caché
│   │   ├── marine/route.ts        # Proxy Open-Meteo marine con caché
│   │   ├── aemet/route.ts         # Observaciones de estaciones AEMET
│   │   ├── meteoclimatic/route.ts # Feed RSS Meteoclimatic por prefijo
│   │   ├── refresh/route.ts       # Control de cooldown refresh
│   │   ├── locations/route.ts     # CRUD ubicaciones guardadas
│   │   └── geocode/route.ts       # Proxy geocodificación
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx
│   ├── home-content.tsx            # Componente principal
│   └── providers.tsx
├── components/
│   ├── CitySearch.tsx              # Autocompletado ciudades
│   ├── ColorLegend.tsx            # Leyenda de color heatmap
│   ├── DailySummary.tsx           # Cards resumen diario
│   ├── InsightsTable.tsx          # Tabla detallada (con columnas marinas opcionales)
│   ├── MapPicker.tsx              # Mapa Leaflet con heatmap
│   ├── MetricPills.tsx            # Selector métricas (land / marine / all)
│   ├── ModelComparisonChart.tsx   # Gráfico Recharts
│   ├── ModelPills.tsx             # Selector modelos
│   ├── RainRadarOverlay.tsx       # Overlay RainViewer
│   ├── RefreshButton.tsx          # Botón refresh con cooldown
│   ├── SavedLocations.tsx         # Lista ubicaciones guardadas
│   ├── StationDashboard.tsx       # Tab de estaciones (AEMET + Meteoclimatic)
│   ├── StationCard.tsx            # Card de observación de estación
│   ├── StationMap.tsx             # Mapa Leaflet de estaciones
│   └── TimeRangeSelector.tsx      # Selector rango temporal
├── lib/
│   ├── appState.ts                # Estado refresh (DB)
│   ├── cacheKey.ts                # Construcción claves caché (forecast + marine)
│   ├── colorScales.ts             # Escalas color por métrica (terrestres + marinas)
│   ├── db.ts                      # Cliente libSQL
│   ├── ensemble.ts                # weightedAvg, contrastText
│   ├── forecastCache.ts           # Gestión caché forecasts
│   ├── heatmapConfig.ts           # Config grid heatmap
│   ├── i18n.ts                    # Traducciones ES/EN (incluye marine)
│   ├── LocaleContext.tsx          # Provider i18n
│   ├── locations.ts              # CRUD ubicaciones guardadas
│   ├── marine.ts                  # Cliente Open-Meteo Marine API
│   ├── marineCache.ts             # Gestión caché marine
│   ├── aemet.ts                   # Cliente AEMET OpenData
│   ├── meteoclimatic.ts           # Cliente + parser RSS Meteoclimatic
│   ├── meteoclimatic-types.ts     # Tipos de observación y regiones
│   ├── models.ts                 # Definición modelos y métricas (con `group: 'land'|'marine'`)
│   ├── openMeteo.ts              # Cliente Open-Meteo forecast (con `includeMarine`)
│   ├── rainViewer.ts             # Cliente RainViewer API
│   ├── usePullToRefresh.ts       # Hook gesto pull-to-refresh (S6)
│   ├── useUrlState.ts            # Hook sincronización URL (con `marine`)
│   └── weatherIcon.ts            # Selector icono meteorológico
├── docs/                          # Documentación
│   ├── PLAN.md
│   ├── ESQUEMA_DATOS.md
│   ├── CONVENCIONES.md
│   ├── DECISIONES.md
│   ├── SPRINTS.md
│   ├── SPRINTS_PLAN.md            # Plan operativo de la funcionalidad de olas
│   └── ESTADO_ACTUAL.md
├── .claude/skills/                # Skills detectadas
├── public/                        # assets estáticos
├── local.db                       # SQLite local
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts (si aplica)
├── postcss.config.mjs
└── eslint.config.mjs
```

---

## 4. Roadmap de sprints

| Sprint | Objetivo |
|--------|----------|
| S1 | Auditoría y documentación (estado actual, deuda técnica, mejoras) |
| S2 | Refresco de datos: cooldown dinámico, historial de refreshes |
| S3 | Dashboard de métricas de rendimiento (cache hit rate, tiempos de respuesta) |
| S4 | **Funcionalidad de olas (marine)**: modelo virtual `marine_global`, 7 métricas, toggle UI, cache independiente. Detalle operativo en `docs/SPRINTS_PLAN.md`. |
| S5 | **Estaciones por ciudad (Meteoclimatic)**: resolución coordenadas → prefijo de provincia, filtrado por radio, conexión con la ciudad buscada. Detalle operativo en `docs/SPRINTS.md`. |
| S6 | **Refresco desde móvil**: indicador accionable, pull-to-refresh, recarga de la última búsqueda aunque haya cooldown. Detalle operativo en `docs/SPRINTS.md`. |
| S7 | **Mejoras estéticas mobile/desktop**: tokens de diseño, bottom tab bar móvil, layout de dos columnas en landscape, pulido desktop. Detalle operativo en `docs/SPRINTS.md`. |

---

## 5. Riesgos conocidos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Rate limiting de Open-Meteo | Media | Alto | Caché 4h, reintentos con backoff, stale-while-revalidate |
| Fallo de geocodificación | Baja | Medio | Cachear resultados 1h, mensaje de error claro |
| Conflictos con React 19 / Next 16 (breaking changes) | Media | Alto | Leer docs de `node_modules/next/dist/docs/` antes de cambios |
| Memoria en cliente con muchos modelos | Media | Medio | Limitar a 6 modelos simultáneos en fetch, forzar largo alcance |
| Leaflet + React Strict Mode | Confirmado | Bajo | `reactStrictMode: false` en next.config.ts |
| Inyección vía parámetros MCP | Baja | Alto | Validación de lat/lon contra rangos válidos (-90/90, -180/180) |
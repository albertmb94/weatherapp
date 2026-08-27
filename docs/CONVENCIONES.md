# CONVENCIONES.md — Weather Model Comparison

## 1. Idioma

- **Código fuente:** Inglés (identificadores, comentarios, mensajes)
- **Base de datos:** Inglés (nombres de tablas y columnas)
- **UI:** Español e Inglés (i18n), con español como default si el navegador está en ES, si no inglés
- **Documentación:** Español de España

---

## 2. Naming

### Tablas y columnas de base de datos
- snake_case: `forecast_cache`, `cache_key`, `fetched_at`, `saved_locations`
- Plural para colecciones: `locations`, `forecasts`
- Singular para entidades: `app_state` (es un key-value store genérico, no colección)

### Variables y funciones
- camelCase: `cacheKey`, `fetchForecast`, `savedLocations`
- Constantes en UPPER_SNAKE_CASE: `COOLDOWN_MS`, `TTL_HOURS`
- Hooks con prefijo `use`: `useUrlState`, `useWeatherData`

### Archivos y componentes
- PascalCase para componentes React: `CitySearch.tsx`, `InsightsTable.tsx`
- kebab-case para archivos de utilidad: `cache-key.ts`, `weather-icon.ts` (aunque en este proyecto se usa camelCase en lib)

### Rutas de API
- kebab-case: `/api/forecast`, `/api/refresh`, `/api/locations`
- Verbos REST: GET (obtener), POST (crear), DELETE (eliminar)

---

## 3. Formatos de datos

### Fechas
- **Almacenamiento:** Timestamps Unix en milisegundos (INTEGER)
- **Display en UI:** Convertir a locale del usuario usando `Intl.DateTimeFormat`
- **Comparaciones:** Siempre en Unix ms, nunca en strings

### Coordenadas
- Latitud: -90 a 90 (float)
- Longitud: -180 a 180 (float)
- Redondeo para caché: 1 decimal

### Divisas
- Stripe (€ EUR) para suscripciones Premium/Stations, configurado vía
  `/admin/features` y `/admin/plans` (no en variables de entorno).

### Zonas horarias
- Los datos de Open-Meteo se asumen en UTC
- Conversión a local solo en UI

### Números
- Temperatura: grados centígrados (°C)
- Velocidad viento: km/h
- Precipitación: mm/h
- Humedad: porcentaje (0-100)
- UV Index: 0-11+

---

## 4. Funciones utilitarias centralizadas

### Parseo y normalización

| Función | Archivo | Firme |
|----------|---------|-------|
| `cacheKey()` | `lib/cacheKey.ts` | `(lat, lon, models, metrics, timeframe) => string` |
| `weightedAvg()` | `lib/ensemble.ts` | `(values: (number\|null)[], weights: number[]) => number\|null` |
| `contrastText()` | `lib/ensemble.ts` | `(hexColor: string) => string` |
| `pickWeatherIcon()` | `lib/weatherIcon.ts` | `(precip: number, temp: number, gusts: number) => WeatherIcon` |

### Validación de inputs

| Función | Archivo | Firme |
|----------|---------|-------|
| `isValidLat()` | — | `(lat: number) => boolean` (rango -90 a 90) |
| `isValidLon()` | — | `(lon: number) => boolean` (rango -180 a 180) |
| `sanitizeJson()` | `app/api/forecast/route.ts` | `(text: string) => string` (reemplaza nan, undefined, Infinity) |

---

## 5. API / errores

### Formato de respuesta exitosa

```typescript
// GET /api/locations
{
  "locations": [
    { "id": 1, "name": "Stuttgart", "latitude": 48.7758, "longitude": 9.1829, "created_at": "..." }
  ]
}

// GET /api/forecast?lat=48.8&lon=9.2&...
{
  "data": { ... },       // datos de Open-Meteo
  "cached": false,       // si se sirvió de caché
  "stale": false         // si la caché era stale
}

// GET /api/refresh
{
  "lastRefresh": 1748438400000,
  "cooldownActive": true,
  "cooldownEndsAt": 1748452800000
}
```

### Formato de errores

```typescript
{
  "error": {
    "code": "RATE_LIMITED" | "GEOCODE_FAILED" | "INVALID_COORDS" | "UNKNOWN",
    "message": "Descripción legible para el usuario"
  }
}
```

### Códigos de error HTTP

| Código | Uso |
|--------|-----|
| 200 | Éxito |
| 400 | Parámetros inválidos (lat/lon fuera de rango, etc.) |
| 429 | Rate limited por Open-Meteo |
| 500 | Error interno del servidor |
| 502/503/504 | Error upstream (Open-Meteo) |

---

## 6. Linters y formatters

| Herramienta | Propósito | Config |
|-------------|-----------|--------|
| ESLint 9 | Linting | `eslint.config.mjs` (next/core-web-vitals + typescript) |
| TypeScript | Type checking | `tsconfig.json` (strict: true) |
| Tailwind CSS 4 | Estilos | `postcss.config.mjs` + `@tailwindcss/postcss` |
| Next.js | Build | `next.config.ts` |

**Formato de indentación:** Espacios, 2 por nivel (delegado a ESLint/Prettier si se añade)

---

## 7. Git

### Convención de commits

```
<tipo>(<alcance>): <descripción>

tipos: feat | fix | refactor | docs | style | test | chore
alcance: opcional, archivo o模块
ejemplo: feat(InsightsTable): añadir selector de bucket
```

### Ramas

```
main              → producción
sprint-XX/tarea   → desarrollo
examples/         → pruebas de concepto
```

No hacer commits directos a `main`. Trabajar siempre en ramas.

---

## 8. Tests

### Qué se testea por capa

| Capa | Qué testear | Ubicación |
|------|-------------|-----------|
| Utils (lib/) | Funciones puras: weightedAvg, contrastText, cacheKey, pickWeatherIcon | `__tests__/` junto al archivo |
| API routes | Respuestas HTTP, caché, errores | `app/api/__tests__/` |
| Components | Renderizado, integración de hooks | `components/__tests__/` |
| E2E | Flujos completos de usuario | `e2e/` (Playwright) |

### Cobertura mínima
- Utils (`lib/`): 70% lines (70% functions, 65% branches) en
  `vitest.config.ts`
- API routes (`app/api/`): 65% lines, 60% functions, 55% branches
- Components: 35% lines, 30% functions, 30% branches
- (El plugin `@vitest/coverage-v8` se instala bajo demanda)

### Imports de tests
```typescript
import { describe, it, expect } from 'vitest'; // o el runner elegido
```

---

## 9. Reglas de formato de código

El formateo se delega a linters y formatters. Esta sección documenta decisiones que no pueden automatizarse.

### Imports
- Usar aliases de TypeScript (`@/*` para rutas relativas al root del proyecto)
- Ordenar imports: built-ins → external packages → internal aliases → relative imports
- Un import por línea

### Tipado
- Preferir `interface` sobre `type` para objetos con múltiples propiedades
- Usar `type` para uniones, intersecciones y alias simples
- No usar `any`; usar `unknown` cuando el tipo sea genuinamente desconocido

### Estado de React
- Usar `useState<T>()` con tipo explícito cuando el inicial sea `null` o `undefined`
- Para estado complejo, tipar con interfaz

---

## 10. Tokens de diseño (S7)

Todos los tokens viven en `app/globals.css` (`@theme inline`). Se exponen
como clases Tailwind (`bg-surface`, `text-text-secondary`, etc.) y como
variables CSS (`var(--surface)`, etc.) para los shims heredados.

### Categorías

| Token | Light | Dark | Uso |
|-------|-------|------|-----|
| `--surface` | `#f8f9fa` | `#0a0a0a` | Fondo de página |
| `--surface-raised` | `#ffffff` | `#111114` | Cards, paneles |
| `--surface-popover` | `#ffffff` | `#18181b` | Tooltips, popovers |
| `--border` | `#e5e7eb` | `#27272a` | Divisores finos |
| `--border-strong` | `#d1d5db` | `#3f3f46` | Hover de borde |
| `--text-primary` | `#111827` | `#ededed` | Texto principal (AA) |
| `--text-secondary` | `#4b5563` | `#a1a1aa` | Texto secundario (AA) |
| `--text-tertiary` | `#6b7280` | `#71717a` | Metadatos |
| `--text-muted` | `#9ca3af` | `#52525b` | Hints / placeholders |
| `--accent` | `#2563eb` | `#3b82f6` | Color de marca |
| `--accent-hover` | `#1d4ed8` | `#60a5fa` | Hover de marca |
| `--accent-soft` | rgba(37,99,235,0.10) | rgba(59,130,246,0.12) | Fondo de pill activa |
| `--success` / `--warning` / `--danger` | | | Estados semánticos |

### Reglas

- **Mínimo de texto:** 11 px. Reservar `text-[9px]`/`text-[10px]` solo
  para badges/etiquetas de una cifra. Aplicado globalmente en
  `app/globals.css` con `font-size: max(11px, 0.875rem)` sobre
  `p/span/li/td/button/...`.
- **Touch target mínimo:** 44 × 44 px en `pointer: coarse` (móvil).
  Aplicado globalmente a `button`, `[role=button]`, `.pill` y `.tab`.
- **No usar gris Tailwind crudo** (`bg-gray-800`, `text-gray-400`, …) en
  código nuevo. Consumir `bg-surface-raised`, `text-text-secondary`, etc.
  El shim `html.light .bg-gray-xxx` se conserva para las pocas clases
  heredadas que aún no se han migrado.
- **Sombras:** reservar `shadow-*` para elementos flotantes (popovers,
  toasts, dropdowns). En superficies planas usar `bg-surface-raised` +
  `border-border`, no `bg-background` + sombra.
- **Radios:** `--radius-sm` (4 px) chips/badges, `--radius` (8 px) cards
  y pills, `--radius-lg` (12 px) modales.
- **Animaciones:** 150 ms estándar. Respetar `prefers-reduced-motion`.
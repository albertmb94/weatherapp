# ESQUEMA_DATOS.md — Weather Model Comparison

## 1. Entidades

### 1.1 `forecast_cache`

Caché de respuestas de Open-Meteo (forecast).

| Campo | Tipo | Nullable | Descripción | Ejemplo |
|-------|------|----------|-------------|---------|
| `cache_key` | TEXT | NO | Clave primaria: lat/lon redondeado + modelos + métricas + timeframe. Ver `lib/cacheKey.ts` | `"48.8,9.2_3_0,1,2,3,4,5,6_24"` |
| `body` | TEXT | NO | JSON stringify de la respuesta de Open-Meteo | `"{\"latitude\":48.8,...}"` |
| `fetched_at` | INTEGER | NO | Timestamp Unix (ms) de cuando se hizo el fetch | `1748438400000` |

**Reglas de integridad:**
- TTL: 2 horas (`REFRESH_WINDOW_MS` en `lib/refreshWindow.ts`). Pasado este tiempo, el caché se considera stale y se fuerza un refetch.
- Purga: si `now - fetched_at > 24 horas`, se purga en el siguiente acceso (`purgeOlderThanMs` / `maxStaleMs` en `lib/forecastCache.ts`).
- Fuente de verdad: `fetched_at` marca cuándo se obtuvo; si el servidor externo falla, se sirve stale con advertencia.

### 1.2 `marine_cache`

Caché de respuestas de Open-Meteo (marine). Esquema paralelo al de
`forecast_cache` para mantener TTL y purga independientes.

| Campo | Tipo | Nullable | Descripción | Ejemplo |
|-------|------|----------|-------------|---------|
| `cache_key` | TEXT | NO | Clave primaria: lat/lon redondeado + métricas marinas + forecast_days. Ver `buildMarineCacheKey` en `lib/cacheKey.ts` | `"41.39,2.17_2_24"` |
| `body` | TEXT | NO | JSON stringify de la respuesta de Open-Meteo Marine | `"{\"latitude\":41.39,...}"` |
| `fetched_at` | INTEGER | NO | Timestamp Unix (ms) de cuando se hizo el fetch | `1748438400000` |

**Reglas de integridad:**
- TTL: 2 horas (`REFRESH_WINDOW_MS`). Pasado este tiempo, el caché se considera stale.
- Purga: si `now - fetched_at > 24 horas`, se purga en el siguiente acceso (`maxStaleMs` en `lib/forecastCache.ts`).
- Solo se rellena esta tabla cuando el flag `marine=1` está activo en la URL.

### 1.3 `app_state`

Estado general de la aplicación.

| Campo | Tipo | Nullable | Descripción | Ejemplo |
|-------|------|----------|-------------|---------|
| `key` | TEXT | NO | Clave primaria | `"last_refresh"` |
| `value` | TEXT | NO | Valor almacenado | `"1748438400000"` |
| `updated_at` | INTEGER | NO | Timestamp Unix (ms) de última actualización | `1748438400000` |

**Claves utilizadas:**
- `last_refresh`: timestamp del último refresh manual

### 1.4 `saved_locations`

> **Nota:** la tabla `saved_locations` ya NO existe en la base de datos.
> Las ubicaciones guardadas son por dispositivo (localStorage, ver
> `lib/localStorageLocations.ts`); `/api/locations` es un stub que
> responde `410 Gone`. Este apartado se conserva como referencia
> histórica del antiguo esquema.

| Campo | Tipo | Nullable | Descripción | Ejemplo |
|-------|------|----------|-------------|---------|
| `id` | INTEGER | NO | Autoincrement, clave primaria | `1` |
| `name` | TEXT | NO | Nombre de la ubicación | `"Stuttgart"` |
| `latitude` | REAL | NO | Latitud (WGS84) | `48.7758` |
| `longitude` | REAL | NO | Longitud (WGS84) | `9.1829` |
| `created_at` | DATETIME | NO | Fecha de creación (default CURRENT_TIMESTAMP) | `2026-05-26 14:30:00` |

**Reglas de integridad:**
- Latitud: -90 a 90
- Longitud: -180 a 180
- name no puede estar vacío

### 1.5 `short_links`

Enlaces cortos compartibles (`/s/[id]`). Snapshot = JSON de params de
URL (sin `locale` ni `basic`, que son locales del dispositivo).

| Campo | Tipo | Nullable | Descripción |
|-------|------|----------|-------------|
| `id` | TEXT | NO | PK. 8 chars aleatorios criptográficos |
| `snapshot` | TEXT | NO | Querystring serializado |
| `created_at` | INTEGER | NO | Unix ms |

**Reglas:** TTL 90 días — se purgan filas expiradas oportunísticamente
en cada escritura (`saveShortLink`). Sin BD, escrituras no-op y lecturas
null (el llamante cae a la URL original).

### 1.6 Tablas de admin/monetización

`feature_flags`, `admin_users`, `admin_sessions`, `admin_credentials`,
`subscriptions`, `user_grants`, `email_templates`, `email_log`,
`affiliate_products`, `affiliate_clicks`, `plans`, `newsletter_subscribers`,
`app_state`, `short_links`, `forecast_cache`, `marine_cache`,
`external_stations_cache`, `page_views`, `sessions`, `events`,
`daily_anon_stats`, `visitor_identity`, `geo_names` — gestionadas por el
panel `/admin`; esquema en `docs/ADMIN.md`. Los valores operativos de
Stripe/Push viven en `feature_flags.config` (JSON), no en variables de
entorno.

Tablas de backtest (ver `lib/backtest/db.ts`): `forecast_archive`,
`observations_era5`, `model_accuracy`, `dynamic_weights`.

---

## 1.7 Datos en URL (estado de UI)

Parámetros sincronizados con la URL mediante `useUrlState`:

| Parámetro | Tipo | Default | Descripción |
|-----------|------|---------|-------------|
| `lat`, `lon` | float | 41.45, 2.2475 | Coordenadas del centro |
| `metric` | string | `temperature` | ID de métrica activa |
| `models` | string | todos | Lista separada por comas (`none` para vacío) |
| `hour` | int | 0 | Índice de hora seleccionada en el slider |
| `range` | int | 336 | Horizonte en horas |
| `bucket` | int | 24 | Bucket de la tabla insights (1, 2, 6, 12, 24; 3/4 aceptados por compatibilidad) |
| `week` | 7/14 | 14 | Días del panel Próximos días y del Resumen diario |
| `emode` | wedai/models | wedai | Modo del ensemble en la tabla Insights |
| `locale` | en/es | auto | Idioma |
| `marine` | 0/1 | 0 | **Toggle de la funcionalidad de olas** |

(El parámetro `map` / overlay de radar se eliminó en B-NEW-37 / 97868dd;
las URLs antiguas que lo incluyan hacen fallback a `view=weather`.)

Cuando `marine=1`, el cliente hace un fetch adicional a
`/api/marine` y lo fusiona en `series['marine_global']` con las
métricas: `wave_height`, `wave_period`, `wave_direction`,
`wind_wave_height`, `wind_wave_period`, `swell_wave_height`,
`swell_wave_period`.

---

## 2. Relaciones

No hay relaciones FK entre tablas. Las tablas son independientes (cachés
transaccionales `forecast_cache`/`marine_cache`/`external_stations_cache`,
key-value `app_state`, entidades propias `saved_locations`, etc.):

**Cardinalidad:** N/A (tablas planas)

**Cascadas de borrado:** N/A (sin FK)

---

## 3. Índices, constraints y claves únicas

### `forecast_cache`
- **PK:** `cache_key` (TEXT PRIMARY KEY)
- **Índice secundario:** No definido explícitamente, pero se usa `fetched_at` para purga (recorrido completo, tabla pequeña)

### `app_state`
- **PK:** `key` (TEXT PRIMARY KEY)

### `saved_locations`
- **PK:** `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- **UUIndex:** No hay constraints de deduplicación de lat/lon (mismo punto puede guardarse con nombres diferentes)

---

## 4. Reglas de integridad y derivación

### Cálculo de `cache_key` (ver `lib/cacheKey.ts`)
1. Redondear lat/lon a **2 decimales** (~1.1 km) y ordenar los pares como set
2. Añadir el resto de params tal cual (incluye `timezone` y el sello `v`)
3. Ordenar entradas alfabéticamente
4. Concatenar: `k1=v1|k2=v2|…`

### Cálculo de media ponderada (`lib/ensemble.ts`)
```
weightedAvg(values, weights, dynamicWeights?, modelIds?, biasCorrection?)
             = Σ(value[i] * weight[i]) / Σ(weight[i])
```
- Ignora valores null/undefined y renormaliza sobre los modelos con datos
- Si todos son null, devuelve null
- Pesos por métrica × bucket de lead time en `ENSEMBLE_PRESETS`
  (lib/models.ts): **calibrados por backtest** con Borda win-rate sobre
  `model_accuracy` — regenerar con
  `npm run backtest && npx tsx scripts/calibrateEnsemble.ts`.
  Los regionales de alta resolución lideran corto plazo dentro de su
  huella de cobertura; los globales toman el relevo desde 96h.
- La reserva IA explícita solo cubre modelos aún no verificables
  (ecmwf_aifs025 / gfs_graphcast025); ncep_aigfs025 ya es calibrado.

### Determinación de icono meteorológico (`lib/weatherIcon.ts`)
```
snowy: precip ≥ 1mm/h AND temperatura ≤ 1°C
stormy: precip ≥ 8mm/h OR wind_gusts ≥ 80 km/h
rainy: precip ≥ 1mm/h (resto)
cloudy: cloud_cover ≥ 75%
partly: cloud_cover ≥ 30% (resto)
sunny: cloud_cover < 30%
```

### Contraste de texto (`lib/colorScales.ts`, `contrastText(rgbString)`)
```
- Extraer RGB del color en formato rgb(r,g,b)
- Luminancia = 0.299*R + 0.587*G + 0.114*B
- Si luminancia > 186 → texto oscuro; si no → blanco
```

---

## 5. Datos de ejemplo

### `forecast_cache`
```json
{
  "cache_key": "hourly=temperature_2m|latitude=41.45|longitude=2.25|models=ecmwf_ifs,…|timezone=auto|v=v4-mixed-models-2026-08-22",
  "body": "{\"latitude\":48.8,\"longitude\":9.2,\"hourly\":{\"temperature_2m\":[15,16,17,...]}}",
  "fetched_at": 1748438400000
}
```

### `saved_locations`
| id | name | latitude | longitude | created_at |
|----|------|----------|-----------|------------|
| 1 | Stuttgart | 48.7758 | 9.1829 | 2026-05-26 14:30:00 |
| 2 | Madrid | 40.4168 | -3.7038 | 2026-05-27 09:15:00 |

### `app_state`
| key | value | updated_at |
|-----|-------|------------|
| last_refresh | 1748438400000 | 1748438400000 |

---

## 6. Notas de implementación

- La base de datos es **local.db** (SQLite embebido via libSQL/Turso)
- En producción requiere `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` (ver `.env.example`)
- En desarrollo usa `file:local.db`
- No hay migraciones formales (schema creado implicitamente en primera conexión)
- La tabla se crea con `CREATE TABLE IF NOT EXISTS` en `lib/db.ts`
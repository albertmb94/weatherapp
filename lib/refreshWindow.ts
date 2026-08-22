/**
 * Single source of truth for the "refresh window" that drives every
 * freshness signal in the app:
 *
 *   - The forecast / marine Turso caches (`forecast_cache`,
 *     `marine_cache`) keep their payload for this many ms.
 *   - The shared external-stations cache (`external_stations_cache`)
 *     uses the same fresh window so AEMET / Meteocat stay aligned
 *     with the rest of the UI.
 *   - The auto-refresh in `app/home-content.tsx` invalidates the
 *     React Query forecast after the cached payload gets older than
 *     this window.
  *   - The manual refresh cooldown in `lib/appState.ts` and the
 *     badges in `AirConditionsGrid` / `CurrentWeatherCard` use the
 *     same constant. (`RefreshButton` was removed in F-9; the age
 *     badge lives in `AirConditionsGrid`.)
 *
 * Keep this in sync with the docs/ESQUEMA_DATOS.md table — the user
 * asked for a 2 h window across the whole stack.
 */
export const REFRESH_WINDOW_MS = 2 * 60 * 60 * 1000

export const REFRESH_WINDOW_HOURS = REFRESH_WINDOW_MS / (60 * 60 * 1000)

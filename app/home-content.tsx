'use client'

import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'

import CitySearch from '@/components/CitySearch'
import ModelSelector from '@/components/ModelSelector'
import DailySummary from '@/components/DailySummary'
import InsightsTable, { type BucketHours, type InsightsDayFilter } from '@/components/InsightsTable'
import MobileTabBar from '@/components/MobileTabBar'
import SavedLocations from '@/components/SavedLocations'
import ErrorBoundary from '@/components/ErrorBoundary'
// RefreshButton was removed from the search bar on 2026-08-18:
// the per-location auto-refresh effect (data.fetchedAt > 2h) is
// the single source of refresh now. The manual refresh still
// lives in SettingsPanel and as the pull-to-refresh gesture.
import FriendlyHome from '@/components/FriendlyHome'
import WeekForecastPanel from '@/components/WeekForecastPanel'
import DesktopSidebar, { type SidebarSection } from '@/components/DesktopSidebar'
import SettingsPanel from '@/components/SettingsPanel'
import CitiesList from '@/components/CitiesList'
// AirQualityCard was removed in the F5 second pass (2026-07-27):
// the air-quality and pollen tiles now live inside the Métricas
// block (see <AirQualityTile> in `AirConditionsGrid.tsx`), so
// the standalone section is no longer rendered anywhere. The
// component file is still in the repo in case we want to
// re-introduce the 10-tile grid in a future iteration.
import { MODELS, METRICS, MARINE_METRIC_IDS, type MetricId, type WeatherModel } from '@/lib/models'
import { fetchForecast, fetchCurrentUv, type CurrentConditions, type ForecastResult } from '@/lib/openMeteo'
import { fetchAirQuality, type AirQualityResult } from '@/lib/airQuality'
import { useUrlState } from '@/lib/useUrlState'
import { useLocale } from '@/lib/LocaleContext'
import { useTheme } from '@/lib/ThemeContext'
import { STRINGS } from '@/lib/i18n'
import { exportForecastCsv, downloadCsv } from '@/lib/exportCsv'
import { floorHourLocation, formatLocationTime, formatLocationDate, formatUtcOffset } from '@/lib/dateUtils'
import { reverseGeocode } from '@/lib/reverseGeocode'
import { saveLocalLocation } from '@/lib/localStorageLocations'
import { useRefresh } from '@/lib/useRefresh'
import { usePullToRefresh } from '@/lib/usePullToRefresh'
import { saveLastView, loadLastView } from '@/lib/lastView'
import { saveLastForecast, loadLastForecast } from '@/lib/forecastIndexedDB'
import { useHourSlider } from '@/lib/hooks/useHourSlider'
import { useSavedLocations } from '@/lib/hooks/useSavedLocations'
import { useClientNow } from '@/lib/hooks/useClientNow'
import { useEffectiveProfile } from '@/lib/hooks/useEffectiveProfile'
import { useNearbyStations } from '@/lib/hooks/useNearbyStations'
import { getLeadTimeBucket } from '@/lib/models'
import { getModelAccuracyByTerrain } from '@/lib/backtest/db'
import { REFRESH_WINDOW_MS } from '@/lib/refreshWindow'
import { shouldAutoRefresh } from '@/lib/autoRefresh'
import { computeInsightsStartIndex } from '@/lib/insightsTime'

// Maximum age (ms) before we silently re-fetch the location's weather
// in the background. The user asked for this to kick in at 2h for
// the same location so a fresh /api/forecast response lands before
// the cache turns stale; we surface it through the refresh badge too.
const AUTO_REFRESH_AGE_MS = REFRESH_WINDOW_MS

function sliceForecast(data: ForecastResult, startIndex: number): ForecastResult {
  const time = data.time.slice(startIndex)
  const timeStrings = data.timeStrings?.slice(startIndex) ?? time.map(t => t.toISOString())
  const series: ForecastResult['series'] = {}
  for (const modelId of Object.keys(data.series)) {
    const metrics = data.series[modelId]
    const out: typeof metrics = {}
    for (const metricId of Object.keys(metrics)) {
      const arr = metrics[metricId]
      out[metricId] = arr === null ? arr : arr.slice(startIndex)
    }
    series[modelId] = out
  }
  // The daily arrays are aligned with the hourly series by construction
  // (every 24th hourly entry shares an index with the corresponding day),
  // so the same `.slice(startIndex)` produces a view that's still
  // aligned with the trimmed hourly series.
  function sliceArr<T>(arr: T[] | undefined): T[] {
    return (arr ?? []).slice(startIndex)
  }
  return {
    time,
    timeStrings,
    series,
    utcOffsetSeconds: data.utcOffsetSeconds,
    fetchedAt: data.fetchedAt,
    dailyTime: sliceArr(data.dailyTime),
    dailyPrecipitationSum: sliceArr(data.dailyPrecipitationSum),
    dailyPrecipitationProbabilityMax: sliceArr(data.dailyPrecipitationProbabilityMax),
    dailyPrecipitationHours: sliceArr(data.dailyPrecipitationHours),
  }
}

// A new deploy changes the hashed chunk filenames. A browser tab that was
// opened before the deploy still references the old names, so lazy-loading a
// route (e.g. the Stations dashboard) throws a ChunkLoadError when its chunk
// 404s. Recover with a one-shot full reload, which fetches fresh HTML that
// points at the current chunks. Guarded via sessionStorage so we never loop.
function importWithChunkReload<T>(factory: () => Promise<T>): Promise<T> {
  return factory().catch((err: unknown) => {
    const isChunkError =
      err instanceof Error &&
      (err.name === 'ChunkLoadError' ||
        /loading chunk|failed to load chunk|dynamically imported module/i.test(err.message))
    if (isChunkError && typeof window !== 'undefined') {
      const KEY = 'chunkReloadAt'
      const last = Number(sessionStorage.getItem(KEY) || '0')
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(KEY, String(Date.now()))
        window.location.reload()
      }
    }
    throw err
  })
}

/**
 * F5 (revised, second pass): pick the pollen value for the
 * current local hour. Extracted as a module-level helper so
 * `useMemo` dependencies in the component body stay stable
 * (otherwise the closure is recreated on every render and
 * the memo would never cache).
 */
function pickPollenAtHour(
  data: AirQualityResult | undefined,
  series: (number | null)[] | undefined,
): number | null {
  if (!data || !series || series.length === 0) return null
  const referenceMs = data.fetchedAt ?? Date.now()
  const referenceLocal = new Date(referenceMs + data.utcOffsetSeconds * 1000)
  const target = referenceLocal.getUTCHours()
  for (let i = 0; i < data.time.length; i++) {
    const t = data.time[i]
    if (!(t instanceof Date)) continue
    if (t.getUTCHours() === target) return series[i] ?? null
  }
  return series[0] ?? null
}

const StationDashboard = dynamic(() => importWithChunkReload(() => import('@/components/StationDashboard')), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
      <div className="animate-spin w-5 h-5 border-2 border-gray-600 border-t-white rounded-full" />
    </div>
  ),
})

const DEFAULT_POS: [number, number] = [41.4500, 2.2475]
const DEFAULT_CITY = 'Badalona'
const DEFAULT_METRIC: MetricId = 'temperature'
const DEFAULT_MODELS = MODELS.map(m => m.id)
// 14-day window is the single supported forecast range; the picker was
// removed from the UI in favour of a fixed horizon. Bump this constant
// if we ever re-introduce the user-facing selector.
const DEFAULT_RANGE = 336
const OPEN_METEO_MAX_DAYS = 16

export default function HomeContent() {
  // M3: keep initial defaults SSR-safe. The `showMap` derivation uses
  // matchMedia which differs between server and client; we apply it in an
  // effect after mount.
  const [defaults] = useState(() => ({
    lat: DEFAULT_POS[0],
    lon: DEFAULT_POS[1],
    metric: DEFAULT_METRIC,
    models: DEFAULT_MODELS,
    hour: 0,
    range: DEFAULT_RANGE,
    bucket: 24,
    locale: '',
    marine: false,
    basic: true,
    view: 'weather' as const,
    weekDays: 14 as const,
    ensembleMode: 'wedai' as const,
  }))
  const [urlState, updateUrl] = useUrlState(defaults)

  const [position, setPosition] = useState<[number, number]>([urlState.lat, urlState.lon])
  // If the user lands on a deep link (`?lat=..&lon=..`) the city name
  // used to default to "Badalona" (the Spanish fallback), so the header
  // showed the wrong name until the user manually searched. We now seed
  // the name with the supplied coordinates and let reverseGeocode (in the
  // URL-sync effect below) overwrite it as soon as the geocoder replies.
  const [cityName, setCityName] = useState(() => {
    const isDefaultUrl = urlState.lat === DEFAULT_POS[0] && urlState.lon === DEFAULT_POS[1]
    return isDefaultUrl ? DEFAULT_CITY : `${urlState.lat.toFixed(2)}, ${urlState.lon.toFixed(2)}`
  })
  const [geoLoading, setGeoLoading] = useState(false)
  // Geocode request counter so an out-of-order reply cannot overwrite a
  // newer city name. Each call increments it; the reply only applies if
  // its counter matches the current one.
  const geocodeSeqRef = useRef(0)
  // B-NEW-40 (2026-08-18): the auto-geolocate effect (B-NEW-36) has been
  // REMOVED. It used `enableHighAccuracy: false`, which on desktop
  // resolves to IP-based geolocation — often tens of km away from the
  // user's real position. That silently rewrote `urlState.lat/lon` to
  // a random spot, and with the 5-km mobile radius the Estaciones tab
  // returned zero stations (the user's report: "antes salían muchas
  // estaciones en Badalona y ahora ninguna"). The user can still
  // geolocate explicitly via the button in the header.
  const [toast, setToast] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // Avanzado default is open on both desktop and mobile per product spec.
  // The user explicitly wants to see the table on first paint.
  const [advancedExpanded, setAdvancedExpanded] = useState(true)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const mapSectionRef = useRef<HTMLElement>(null)
  const stationsSectionRef = useRef<HTMLElement>(null)
  const scrollToMapRef = useRef(false)
  const scrollToStationsRef = useRef(false)
  const { locale, toggleLocale } = useLocale()
  const { theme, cycleTheme } = useTheme()
  // Refresh hook: the per-location auto-refresh is the primary
  // refresh path now (driven by `data.fetchedAt > 2h` below). The
  // hook's `refresh` mutation is still wired to SettingsPanel and
  // to the pull-to-refresh gesture as an escape hatch — the user
  // asked for the buttons next to the search bar to be removed on
  // 2026-08-18 because the auto-refresh is reliable enough that the
  // manual button wasn't pulling its weight.
  const { refresh } = useRefresh()
  // Sprint 13: the auto-derived profile for the current location.
  // Resolved asynchronously from `classifyTerrain`; `null` until
  // the elevation API replies (or forever, if it never does).
  const effectiveProfile = useEffectiveProfile(position[0], position[1])
  const queryClient = useQueryClient()
  // BUG FIX (2026-08-18): this hook was added so the nowcast
  // (closest-station blend) actually receives a non-empty list of
  // stations. The previous build hard-coded `stations=[]` in
  // `FriendlyHome`, so the nowcast hook always ran with an empty
  // list and the "station + ensemble" temperature blend was silently
  // disabled. AEMET publishes every 10 min, so a 5-min staleTime plus
  // a 5-min refetchInterval keeps the list fresh without spamming
  // the API.
  //
  // We source the coords from `urlState.lat` / `urlState.lon`
  // directly (not from the local `position` state) so the nowcast
  // uses the URL-of-record the moment a deep link or back/forward
  // changes the location. The local `position` state is only used
  // for imperative moves (map drag, geolocation) and lags by one
  // render when the URL changes.
  // `useNearbyStations` defaults to a 5-km radius (matching the
  // mobile default of `StationDashboard`), so the nowcast blend uses
  // the same stations the user sees in the Estaciones tab without
  // passing an explicit radius here.
  const nearbyStations = useNearbyStations({
    lat: urlState.lat,
    lon: urlState.lon,
  })

  // S7.5: header collapses on mobile portrait once the user scrolls past the
  // metric pills row, and re-expands when they scroll back up. Disabled on
  // desktop and on mobile-landscape (where the toolbar is already compact).
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false)

  // B10: sync local position / cityName from urlState. This makes back/
  // forward navigation, and any external URL change, actually drive the
  // map and forecast. The position is derived from the URL during render
  // so we don't need a state-update-in-effect for the common case; the
  // reverseGeocode effect below fills in the city name asynchronously.
  if (position[0] !== urlState.lat || position[1] !== urlState.lon) {
    // Update lazily on the next render — React lets us call a state setter
    // during render to derive state from a prop, which is the documented
    // pattern for "props into state".
    setPosition([urlState.lat, urlState.lon])
  }

  // When the URL points at coords other than the default we also reverse-
  // geocode so the header shows the actual city instead of the stale
  // default. This used to silently display "Badalona" on deep links.
  useEffect(() => {
    const isDefault = urlState.lat === DEFAULT_POS[0] && urlState.lon === DEFAULT_POS[1]
    if (!isDefault) {
      const seq = ++geocodeSeqRef.current
      void reverseGeocode(urlState.lat, urlState.lon, locale).then(name => {
        if (seq !== geocodeSeqRef.current) return
        if (name) setCityName(name)
      })
    } else if (cityName !== DEFAULT_CITY) {
      // Falling back to the default city name when the URL is on the
      // default coords is the documented "props into state" pattern.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCityName(DEFAULT_CITY)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlState.lat, urlState.lon, locale])

  // B-NEW-40 (2026-08-18): the auto-geolocate effect (B-NEW-36) has been
  // REMOVED. It used `enableHighAccuracy: false`, which on desktop
  // resolves to IP-based geolocation — often tens of km away from the
  // user's real position. That silently rewrote `urlState.lat/lon` to
  // a random spot, and with the 5-km mobile radius the Estaciones tab
  // returned zero stations (the user's report: "antes salían muchas
  // estaciones en Badalona y ahora ninguna"). The user can still
  // geolocate explicitly via the button in the header, which uses
  // the same GPS-quality API but only fires on demand.

  // M-UI-6: persist the user's last view (metric, models, range, …)
  // so that returning later without a URL still restores their
  // preferences. Position is intentionally NOT persisted — it's tied
  // to the city the user picked and they can re-pick it. We save
  // whenever the state changes after the first paint.
  // M-UI-6: persist the user's last view (metric, models, range, ...)
  // so that returning later without a URL still restores their
  // preferences. Position is intentionally NOT persisted — it's tied
  // to the city the user picked and they can re-pick it. We save with a
  // 500ms debounce so a flurry of URL state changes (e.g. dragging the
  // hour slider) doesn't fire a localStorage write on every frame.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      saveLastView({
        metric: urlState.metric,
        models: urlState.models,
        range: urlState.range,
        bucket: (urlState.bucket === 1 || urlState.bucket === 2) ? 24 : urlState.bucket,
        marine: urlState.marine,
        basic: urlState.basic,
      })
    }, 500)
    return () => window.clearTimeout(handle)
  }, [
    urlState.metric, urlState.models, urlState.range,
    urlState.bucket,
    urlState.marine, urlState.basic,
  ])

  // M-UI-6 companion: on first mount, if the URL has no params at all
  // (clean /), restore the last-view prefs into URL state. We use a
  // ref to avoid running this more than once.
  const lastViewAppliedRef = useRef(false)
  useEffect(() => {
    if (lastViewAppliedRef.current) return
    lastViewAppliedRef.current = true
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    if ([...sp.keys()].length > 0) return // URL has params; user came from a share
    const saved = loadLastView()
    if (!saved) return
    // Validate models from lastView: filter out any IDs that no longer exist
    const validIds = new Set(MODELS.map(m => m.id))
    const safeModels = saved.models.filter(id => validIds.has(id))
    updateUrl({
      metric: saved.metric,
      models: safeModels.length > 0 ? safeModels : DEFAULT_MODELS,
      range: saved.range,
      bucket: saved.bucket,
      marine: saved.marine,
      basic: saved.basic,
    })
  }, [updateUrl])

  useEffect(() => {
    if (!mobileMenuOpen) return
    function onDown(e: MouseEvent | TouchEvent) {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [mobileMenuOpen])

  // Close the mobile menu whenever the layout switches to "desktop" (either
  // viewport >= md or landscape orientation on a phone). This prevents the
  // mobile dropdown from staying "open" in state and re-appearing the next
  // time the user rotates back to portrait.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const landscapeMql = window.matchMedia('(orientation: landscape)')
    const desktopMql = window.matchMedia('(min-width: 768px)')
    const onChange = () => {
      if (landscapeMql.matches || desktopMql.matches) {
        setMobileMenuOpen(false)
      }
    }
    onChange()
    landscapeMql.addEventListener('change', onChange)
    desktopMql.addEventListener('change', onChange)
    return () => {
      landscapeMql.removeEventListener('change', onChange)
      desktopMql.removeEventListener('change', onChange)
    }
  }, [])

  // The Avanzado content (InsightsTable, DailySummary, ModelSelector)
  // renders alongside the rest of the page so the user sees the
  // table on first paint per the product spec. The multi-model
  // comparison chart (WedAI/Models line chart) was removed on
  // 2026-07-28: the SVG never rendered reliably in the column
  // layout, so the section now ends with the InsightsTable.

  useEffect(() => {
    if (urlState.locale && urlState.locale !== locale) {
      toggleLocale()
    }
  }, [urlState.locale, locale, toggleLocale])

  // S7.5: collapse the mobile header on scroll. Bound to the window scroll
  // position; we don't need IntersectionObserver since the header is
  // already sticky. Threshold matches the metric-pills row (48 px). We use
  // a ref for the current state so the listener can be wired up once and
  // stay in sync with the latest render.
  const collapsedRef = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    let lastY = window.scrollY
    let frame = 0
    function onScroll() {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        const y = window.scrollY
        if (y > 80 && y > lastY && !collapsedRef.current) {
          collapsedRef.current = true
          setIsHeaderCollapsed(true)
        } else if (y < 40 && y < lastY && collapsedRef.current) {
          collapsedRef.current = false
          setIsHeaderCollapsed(false)
        }
        lastY = y
        frame = 0
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  // M-UI-4: refresh outcome toast is disabled — every URL state change
  // re-renders home-content and the `lastOutcome` ref check would re-fire
  // (we re-created the ref each time) which caused the toast to re-appear
  // whenever the user scrolled the page. The refresh button itself gives
  // visual feedback (spinner, age), so the toast is redundant for the
  // user. We keep the toast for the other actions (save, geolocate error)
  // but never for refresh.

  const selectedMetric = urlState.metric as MetricId
  const selectedModels = urlState.models
  const selectedHour = urlState.hour
  const selectedRange = urlState.range
  const bucket = urlState.bucket as BucketHours
  const marine = urlState.marine
  const showBasic = urlState.basic
  const selectedView: SidebarSection = urlState.view
  const weekDays: 7 | 14 = urlState.weekDays
  const ensembleMode = urlState.ensembleMode

  // Keep `range` in sync with `weekDays` so the forecast fetch covers
  // enough hours for the Próximos días panel regardless of which URL
  // params the user landed on. Without this, a deep link like
  // ?range=168&week=14 silently caps Próximos días to 7 days because the
  // API only returned 7 days of data.
  useEffect(() => {
    const required = weekDays * 24
    if (urlState.range < required) {
      updateUrl({ range: required })
    }
  }, [weekDays, urlState.range, updateUrl])

  // Always fetch the maximum days so DailySummary always has enough data
  // for 14 days regardless of range / weekDays state or past_days offset.
  const forecastDays = OPEN_METEO_MAX_DAYS

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['forecast', position[0], position[1], forecastDays, marine],
    queryFn: ({ signal }) => fetchForecast(position[0], position[1], MODELS, METRICS, forecastDays, signal, marine),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
    // F-5: keep the previous forecast on screen while a new fetch is in
    // flight, so the city-search / range slider don't briefly flash
    // dashes. We only keep the placeholder if the position hasn't
    // changed (i.e. only the range / marine flag toggled).
    placeholderData: (prev, prevQuery) => {
      if (!prev) return prev
      const prevKey = prevQuery?.queryKey as unknown[] | undefined
      if (!prevKey || prevKey[1] !== position[0] || prevKey[2] !== position[1]) {
        return undefined
      }
      return prev
    },
  })

  // Auto-refresh: after the forecast for *this* location is older than
  // REFRESH_WINDOW_MS (2h), kick off a silent background refresh. The user
  // requested this explicitly so a fresh /api/forecast response lands
  // before the Turso cache turns stale, and we surface it through the
  // refresh badge too — see useQuery refetch(). React Query's
  // `staleTime` only marks stale; the actual fire happens via
  // refetchOnWindowFocus and the explicit invalidation here.
  const lastFetchedAt = data?.fetchedAt
  // `forecastAgeMs` and the auto-refresh trigger rely on `Date.now()`,
  // which is impure. We compute it once on mount + every refresh, then
  // tick it forward via `currentTickMs` (updated 1× per minute by an
  // effect below) so the "Refresh due" badge actually ticks.
  //
  // B-NEW-20 (2026-07-27): the previous `useState(() => Date.now())`
  // initializer captured the server's clock on SSR and the
  // client's clock on hydration — even if the tick interval
  // re-syncs them every 60s, the *initial* value differed
  // between renders and React aborted with hydration error
  // #418 on the "Updated 5m ago" / "Recarga pendiente 4h"
  // text node rendered from `forecastAgeMs`. We start the
  // state at `null` (matches the SSR render and the first
  // client render) and set the actual `currentTickMs` in the
  // same `useEffect` that starts the tick interval — that
  // Reuses `useClientNow` so the pattern (server-time on the SSR
  // pass, ticking every 1 min thereafter) lives in one place. Drives
  // the `forecastAgeMs` calculation that powers auto-refresh below.
  const currentTickMs = useClientNow(60_000) ?? 0
  const forecastAgeMs = lastFetchedAt
    ? Math.max(0, currentTickMs - lastFetchedAt)
    : null
  // B-NEW-31 (2026-08-18): throttle the auto-refresh so we don't
  // hammer the upstream API if the same forecast payload keeps
  // coming back stale (cache hit returning the same `fetchedAt`,
  // network failure, etc.). `useClientNow` ticks every minute so
  // the predicate above will keep re-firing as long as the data
  // is older than 2h — that's correct, but without a debounce each
  // tick would re-issue invalidateQueries, which React Query would
  // then either ignore (in-flight) or schedule (back-to-back), and
  // the user would see the cache lock in a stale state. The helper
  // `shouldAutoRefresh` folds the throttle + in-flight + visibility
  // checks into a single boolean; the ref tracks the last
  // invalidation wall-clock so we don't refire within the throttle
  // window.
  const lastAutoRefreshAtRef = useRef(0)
  const AUTO_REFRESH_THROTTLE_MS = 60_000
  useEffect(() => {
    const isVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden'
    if (!shouldAutoRefresh({
      forecastAgeMs,
      refreshWindowMs: AUTO_REFRESH_AGE_MS,
      isFetching,
      lastRefreshAt: lastAutoRefreshAtRef.current,
      now: currentTickMs || Date.now(),
      isVisible,
      throttleMs: AUTO_REFRESH_THROTTLE_MS,
    })) {
      return
    }
    lastAutoRefreshAtRef.current = currentTickMs || Date.now()
    queryClient.invalidateQueries({ queryKey: ['forecast', position[0], position[1], forecastDays, marine] })
  }, [forecastAgeMs, isFetching, currentTickMs, queryClient, position, forecastDays, marine])

  // Live UV (provider `current=uv_index`, ~15 min cadence). Separate
  // query so its lifecycle is independent of the ensemble forecast and
  // so we can show its valid-at timestamp in the UI.
  const { data: liveUv } = useQuery<CurrentConditions>({
    queryKey: ['currentUv', position[0], position[1]],
    queryFn: ({ signal }) => fetchCurrentUv(position[0], position[1], signal),
    // Refresh once an hour or when the user comes back to the tab. The
    // provider's `current` block is ~15 min, so 15 min would be enough,
    // but a more relaxed cadence keeps cost low while still keeping the
    // card visibly fresh.
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
  })

  // F5: air quality + pollen. The Open-Meteo air-quality endpoint
  // exposes a separate forecast (5-day max) so it lives in its
  // own query. F5 (revised): we ALWAYS run this query now because
  // the EU AQI tile is rendered inside the Métricas block on
  // every viewport (mobile included). The full tile card above
  // is still gated to desktop / mobile landscape, but the
  // headline value must be available everywhere.
  const airQualityQuery = useQuery<AirQualityResult>({
    queryKey: ['air-quality', position[0], position[1]],
    queryFn: ({ signal }) => fetchAirQuality(position[0], position[1], { signal }),
    staleTime: 60 * 60 * 1000, // 1h — air quality changes on the order of hours
    refetchOnWindowFocus: true,
  })

  // F5 (revised): pick the EU AQI value for the current local
  // hour. The air-quality series is aligned with the location's
  // local time (the API honours `timezone=auto`), so we find
  // the index whose UTC-fake-local `hour` matches the current
  // wall clock floored to the hour. When the data hasn't
  // arrived yet we return `null` so the Métricas tile stays
  // hidden rather than showing a misleading "—".
  const currentEuropeanAqi = useMemo<number | null>(() => {
    const data = airQualityQuery.data
    if (!data) return null
    const arr = data.series.european_aqi
    if (!arr || arr.length === 0) return null
    // Anchor the lookup on the forecast's `fetchedAt` so
    // server and client agree on the row (same trick the
    // forecast uses via `startIndex`). Fall back to the
    // shared `currentTickMs` (the same wall-clock value
    // every other consumer in this file reads) instead of
    // `Date.now()` so the React purity rule is satisfied
    // and SSR / hydration stay consistent — `currentTickMs`
    // is 0 on the first client render and starts ticking
    // once the `useClientNow` effect runs.
    const referenceMs = data.fetchedAt ?? currentTickMs
    const referenceLocal = new Date(referenceMs + data.utcOffsetSeconds * 1000)
    const target = referenceLocal.getUTCHours()
    for (let i = 0; i < data.time.length; i++) {
      const t = data.time[i]
      if (!(t instanceof Date)) continue
      if (t.getUTCHours() === target) return arr[i] ?? null
    }
    return arr[0] ?? null
  }, [airQualityQuery.data, currentTickMs])

  // F5 (revised, second pass): same hour-aligned lookup for
  // the two pollen readings surfaced in the Métricas block.
  // Each tile consumes its own value so the parent stays a
  // pure view; the toggle state lives inside
  // `AirConditionsGrid`.
  const currentGrassPollen = useMemo(
    () => pickPollenAtHour(airQualityQuery.data, airQualityQuery.data?.series.grass_pollen),
    [airQualityQuery.data],
  )
  const currentBirchPollen = useMemo(
    () => pickPollenAtHour(airQualityQuery.data, airQualityQuery.data?.series.birch_pollen),
    [airQualityQuery.data],
  )

  // F5: viewport detection — desktop or mobile landscape.
  // F5 (revised, second pass): the standalone `AirQualityCard`
  // is gone, so the viewport gate is no longer needed. The
  // air-quality query still runs on every viewport because the
  // Métricas block now consumes the EU AQI and pollen values
  // on mobile too.

  // F-5: persist every successful forecast to IndexedDB so the user
  // can read their last known data offline. Best-effort; failures are
  // swallowed inside `saveLastForecast`.
  //
  // We use the upstream `data.fetchedAt` rather than `Date.now()` so
  // two snapshots belonging to the same upstream response share the
  // same key. Without this the "last seen" time displayed when the
  // user goes offline can jump forward even though the underlying
  // forecast payload is byte-identical.
  useEffect(() => {
    if (!data) return
    void saveLastForecast({
      position: [position[0], position[1]],
      cityName,
      utcOffsetSeconds: data.utcOffsetSeconds,
      fetchedAt: data.fetchedAt,
      data,
    })
  }, [data, position, cityName])

  // F-5: when the query has errored (offline, timeout, etc.), hydrate from
  // IndexedDB so the app stays useful. We now load by exact location so
  // a snapshot for a different city can no longer be presented under the
  // current city's name.
  const [offlineSnapshot, setOfflineSnapshot] = useState<Awaited<ReturnType<typeof loadLastForecast>>>(null)
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    if (error || !navigator.onLine) {
      // Async hydrate; the cleanup effect below clears it on next success.
      void loadLastForecast([position[0], position[1]]).then(s => {
        if (s) setOfflineSnapshot(s)
      })
    }
  }, [error, position])
  // Clear the offline snapshot when we successfully come back online.
  const offlineCleanupRef = useRef(false)
  useEffect(() => {
    if (error) {
      offlineCleanupRef.current = true
      return
    }
    if (offlineCleanupRef.current) {
      offlineCleanupRef.current = false
      setOfflineSnapshot(null)
    }
  }, [error])

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Cities are private to this device: stored in localStorage only.
      // The old /api/locations endpoint was a public, anonymous list shared
      // across every visitor — a privacy bug for what should be personal
      // bookmarks. We write locally and announce success on failure only
      // when the local storage write actually succeeded.
      try {
        saveLocalLocation(cityName, position[0], position[1])
        return { ok: true, local: true }
      } catch (err) {
        throw err
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-locations'] })
      setToast(locale === 'en' ? `Saved ${cityName}` : `Guardado ${cityName}`)
    },
    onError: () => {
      setToast(locale === 'en' ? 'Could not save city' : 'No se pudo guardar la ciudad')
    },
  })

  // Mirrors the Cities panel's lookup so we can highlight when the current
  // location is already bookmarked. Cities live entirely in localStorage now,
  // routed through the S4 `useSavedLocations` hook so the cache is shared
  // with `CitiesList` (one query subscription for both panels).
  const { saved: savedLocations } = useSavedLocations()

  // B-NEW-29 (2026-07-30): the smart-Save state shared by
  // every Save button in the app. `currentCityId` is the id of
  // the saved record whose name + ~50 m coords match the
  // currently-loaded city; when it's defined the Save buttons
  // (mobile menu AND the CitiesList big one) flip into
  // "already saved" mode instead of letting the user double-tap
  // and end up with the same city listed two or three times.
  // The tolerance is intentionally the same one used inside
  // `saveLocalLocation`'s dedup check, so the UI and the data
  // layer agree on what "the same place" means.
  const currentCityId = useMemo(() => {
    return savedLocations?.find(l =>
      l.name === cityName &&
      Math.abs(l.latitude - position[0]) < 0.0005 &&
      Math.abs(l.longitude - position[1]) < 0.0005
    )?.id
  }, [savedLocations, cityName, position])
  const isCurrentCitySaved = currentCityId !== undefined

  const handleCitySelect = useCallback((name: string, lat: number, lon: number) => {
    setCityName(name)
    setPosition([lat, lon])
    updateUrl({ lat, lon })
  }, [updateUrl])

  const handleMetricChange = useCallback((id: MetricId) => {
    updateUrl({ metric: id })
  }, [updateUrl])

  const handleModelChange = useCallback((ids: string[]) => {
    updateUrl({ models: ids })
  }, [updateUrl])

  const handleEnsembleModeChange = useCallback((mode: 'wedai' | 'models') => {
    updateUrl({ ensembleMode: mode })
  }, [updateUrl])

  const handleHourChange = useCallback((hour: number) => {
    // Clamp to a valid hour range for the current dataset so the slider
    // and downstream consumers never read an out-of-range index. Effective
    // max is computed below (effectiveMaxHours). Older code stored any
    // URL-driven value, which could be > maxModelHours after switching
    // to a 48h regional model and produce `max=-1` for the slider.
    const safe = Number.isFinite(hour) ? Math.max(0, Math.floor(hour)) : 0
    updateUrl({ hour: safe })
  }, [updateUrl])

  // B-NEW-37 (2026-08-18): `handleMapToggle` removed — no UI flips
  // `showMap` to true any more, so the toggle would be dead code.

  const handleMarineToggle = useCallback(() => {
    const next = !marine
    const updates: Partial<typeof urlState> = { marine: next }
    if (!next) {
      const currentMetric = urlState.metric as MetricId
      const isMarineMetric = MARINE_METRIC_IDS.includes(currentMetric)
      if (isMarineMetric) updates.metric = DEFAULT_METRIC
    }
    updateUrl(updates)
  }, [marine, urlState.metric, updateUrl])

  const handleBasicToggle = useCallback(() => {
    updateUrl({ basic: !showBasic })
  }, [showBasic, updateUrl])

  const handleBucketChange = useCallback((b: BucketHours) => {
    updateUrl({ bucket: b })
  }, [updateUrl])

  const handleViewSelect = useCallback((section: SidebarSection) => {
    // B-NEW-37 (2026-08-18): the Mapa nav entry is gone from the
    // sidebar / mobile-tab union, so `section` can never be 'map' any
    // more. The `showMap` reset below remains so a stale ?showMap=1
    // saved view still tears down the (now-disabled) map state.
    updateUrl({ view: section })
  }, [updateUrl])

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const lat = pos.coords.latitude
        const lon = pos.coords.longitude
        const seq = ++geocodeSeqRef.current
        setPosition([lat, lon])
        const name = await reverseGeocode(lat, lon, locale)
        if (seq !== geocodeSeqRef.current) return
        setCityName(name || `${lat.toFixed(2)}, ${lon.toFixed(2)}`)
        updateUrl({ lat, lon })
        setGeoLoading(false)
      },
      () => {
        setGeoLoading(false)
        setToast(locale === 'en' ? 'Location access denied' : 'Acceso a ubicación denegado')
      },
      { enableHighAccuracy: false, timeout: 5000 }
    )
  }, [updateUrl, locale])

  // Filter out the virtual marine model only when the marine toggle is
  // *off*. With marine=on we keep every model so that the chart, the
  // Insights table and the friendly cards still compute proper averages
  // and gradients — the InsightsTable hides the basic land columns on
  // its own when `showBasic=false`, so the user keeps the marine view
  // without losing land-model coverage.
  const displayModels = useMemo(
    () => (marine ? MODELS : MODELS.filter(m => m.id !== 'marine_global')),
    [marine]
  )
  const displayActiveModelIds = useMemo(
    () => (marine ? selectedModels : selectedModels.filter(id => id !== 'marine_global')),
    [marine, selectedModels]
  )

  // B-NEW-8 (2026-07-24): anchor the "current hour" on the forecast's
  // `fetchedAt` timestamp instead of `Date.now()`. Without this, the
  // same city shows different values on mobile vs desktop because each
  // device's `Date.now()` is different (a phone refreshed at 12:30
  // would land on a different row than a laptop refreshed at 13:00,
  // even though they're looking at the *same* forecast). The fix
  // uses the timestamp the server stamped on the response
  // (`X-Forecast-Fetched-At` → `data.fetchedAt`), so the same
  // cached response always resolves to the same `startIndex`
  // regardless of which device reads it. The trade-off is that
  // "ahora" is now "the hour the forecast was issued" rather than
  // the actual wall-clock hour — within the 4-hour auto-refresh
  // window this is at most a few hours stale, and the URL state's
  // `hour` param still lets the user navigate to the actual
  // current hour if they want a specific future time.
  const startIndex = useMemo(() => {
    const effectiveData = data ?? offlineSnapshot?.data
    if (!effectiveData?.time?.length) return 0
    // B-NEW-39 (2026-08-18): anchor `startIndex` on the client wall
    // clock so the hourly forecast strip always starts at the current
    // hour, not the hour the forecast was issued. The previous
    // behaviour used `effectiveData.fetchedAt` as the anchor, which
    // meant a forecast cached at 7h would still start at 7h when
    // the user opens the app at 8:30h — visible as a "ghost hour"
    // row that the user has to scroll past to reach the current hour.
    // We still fall back to `fetchedAt` when the client clock isn't
    // ready yet (SSR + first render before the `useClientNow` effect
    // fires) so we don't trip React 19's hydration warning.
    const referenceMs = currentTickMs || effectiveData.fetchedAt
    if (!referenceMs) return 0
    // Convert the UTC reference timestamp into the location's
    // UTC-fake-local representation (same shape as the time[]
    // entries), then floor to the hour. `getLocationNow` does the
    // same offset arithmetic; we just feed it the wall clock instead
    // of the fetchedAt ms.
    const referenceLocal = new Date(referenceMs + effectiveData.utcOffsetSeconds * 1000)
    const nowFloor = floorHourLocation(referenceLocal)
    const nowTs = nowFloor.getTime()
    for (let i = 0; i < effectiveData.time.length; i++) {
      const t = effectiveData.time[i]
      if (t instanceof Date && t.getTime() >= nowTs) return i
    }
    return effectiveData.time.length
  }, [data, offlineSnapshot, currentTickMs])

  // The Insights table has its own, stricter "current hour" anchor.
  // The shared `startIndex` above is intentionally tied to
  // `fetchedAt` so a cached response always resolves to the same row
  // across devices — but the user asked the Insights table to start
  // at the *current wall-clock hour* (e.g. 17:00 when it's 17:52),
  // regardless of when the cached forecast was issued. We compute
  // that here against `currentTickMs` and only fall back to
  // `startIndex` (the `fetchedAt`-anchored value) before the client
  // has hydrated, so the SSR / first-paint output stays consistent
  // with the rest of the UI and we don't introduce a hydration
  // mismatch.
  const insightsStartIndex = useMemo(() => {
    const effectiveData = data ?? offlineSnapshot?.data
    if (!effectiveData?.time?.length) return startIndex
    // `currentTickMs` is 0 until the client effect fires (see the
    // useClientNow comment in lib/hooks/useClientNow.ts). Use the
    // shared `startIndex` in that case so the first render and the
    // hydrated render produce the same value.
    if (!currentTickMs) return startIndex
    return computeInsightsStartIndex(
      effectiveData.time,
      effectiveData.utcOffsetSeconds,
      currentTickMs,
    )
  }, [data, offlineSnapshot, currentTickMs, startIndex])

  // Use live data if available, otherwise fall back to offline snapshot
  const effectiveData = data ?? offlineSnapshot?.data ?? null

  // Sprint 13: profile-driven backtest recommendation. The TerrainType
  // is the raw output of `classifyTerrain` and feeds
  // `getModelAccuracyByTerrain` (terrain-wide, topN). The result is a
  // Set<string> of recommended model ids, intersected with the user's
  // active set so the chip in FriendlyHome reflects what the boost
  // actually affected. While the backtest hasn't produced rows for
  // the current terrain (the weekly job has not yet run, or this
  // terrain is new), `recommendedSet` is empty and the ensemble is
  // computed exactly as before.
  //
  // We initialise the state with an empty Set and update it via
  // setState inside the effect — the cascading-update lint that
  // synchronous setState-in-effect would trigger is intentional
  // here because the alternative (deriving `recommendedSet` from
  // props) is impossible: the backtest result is async by design.
  const [recommendedSet, setRecommendedSet] = useState<Set<string>>(() => new Set())
  // The setState calls below are inside a useEffect that synchronises
  // the backtest result (async by design) with the React state. The
  // `react-hooks/set-state-in-effect` rule flags this pattern but
  // it is correct here because the alternative — deriving
  // `recommendedSet` from props — is impossible: the backtest is
  // async, runs once per terrain, and the result must be cached.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const terrain = effectiveProfile.terrain
    if (!terrain) {
      setRecommendedSet(new Set())
      return
    }
    // The lead-time bucket for the recommendation comes from the
    // current "now" hour (lead time 0). We only query one bucket
    // (0-24h) — the recommendation is stable enough across lead
    // times that we don't need to refetch on every hour tick. If
    // the backtest eventually ships per-bucket recommendations,
    // this is the place to extend.
    const leadBucket = getLeadTimeBucket(0)
    let cancelled = false
    void getModelAccuracyByTerrain(terrain.type, selectedMetric, leadBucket, { topN: 5 })
      .then(rows => {
        if (cancelled) return
        setRecommendedSet(new Set(rows.map(r => r.model_id)))
      })
      .catch(() => {
        if (cancelled) return
        setRecommendedSet(new Set())
      })
    return () => {
      cancelled = true
    }
  }, [effectiveProfile.terrain, selectedMetric])
  /* eslint-enable react-hooks/set-state-in-effect */

  // The number of recommendation entries that actually overlap with
  // the user's active model selection — surfaced in the chip so the
  // user can see whether the boost is taking effect (a coastal city
  // The number of recommendation entries that overlap with
  // the user's active model selection used to be surfaced in
  // a chip on FriendlyHome so the user could see whether the
  // boost was taking effect (a coastal city with no marine-
  // aware models active would show 0 even if the backtest
  // returned a marine recommendation). The chip was dropped
  // in F5 (the user reported it was an "FYI with no
  // follow-up"), so the computation no longer needs to run
  // here. The math is still in `useMemo` block of the parent
  // so the recommendation set keeps driving the snapshot's
  // `meanAcrossModels` via `usageProfileRecommended` below.

  const viewData = useMemo(() => {
    if (!effectiveData) return null
    if (startIndex === 0) return effectiveData
    return sliceForecast(effectiveData, startIndex)
  }, [effectiveData, startIndex])

  const hourLabel = useMemo(() => {
    const t = viewData?.time?.[selectedHour]
    if (!(t instanceof Date)) return `+${selectedHour}h`
    const hh = formatLocationTime(t, locale, { hour: '2-digit', minute: '2-digit', hour12: false })
    const dd = formatLocationDate(t, locale, { weekday: 'short', day: '2-digit', month: '2-digit' })
    return `${dd} ${hh}`
  }, [viewData, selectedHour, locale])

  const utcOffsetLabel = useMemo(() => {
    if (!effectiveData) return ''
    return formatUtcOffset(effectiveData.utcOffsetSeconds)
  }, [effectiveData])

  // Keep `selectedHour` inside the valid window for the current dataset
  // and model selection. Without this, switching to a 48-hour regional
  // model could leave the slider pointing past the new max and produce
  // `max=-1` in the UI. (Sprint 10: extracted to `useHourSlider`.)
  const {
    effectiveMaxHours,
    safeSelectedHour,
  } = useHourSlider({
    selectedHour,
    selectedRange,
    selectedModels,
    viewTimesLength: viewData?.time.length ?? 0,
  })

  // After trimming, hour index 0 IS the current hour by construction.
  const jumpToNow = useCallback(() => {
    handleHourChange(0)
  }, [handleHourChange])

  // S6.3: pull-to-refresh on the main content container. Disabled on
  // desktop (`pointer: coarse` only) and on `prefers-reduced-motion`
  // (the gesture would be janky anyway without an animation).
  const pullToRefreshRef = usePullToRefresh<HTMLDivElement>({
    onRefresh: refresh,
    threshold: 80,
    disabled: typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches,
  })

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleHourChange(Math.max(0, selectedHour - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleHourChange(Math.min(effectiveMaxHours - 1, selectedHour + 1))
      } else if (e.key === '/') {
        e.preventDefault()
        document.getElementById('city-search-input')?.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
    // B-NEW-37 (2026-08-18): dropped `showMap` from the deps — the
    // 'm' shortcut that toggled the map is gone and the only thing
    // that flipped `showMap` on is the (now-disabled) map section.
  }, [selectedHour, effectiveMaxHours, handleHourChange, handleViewSelect])

  // B-NEW-37 (2026-08-18): the scroll-to-map effect is gone — the
  // map section is permanently disabled, so there's nothing to
  // scroll into view.

  // When the mobile tab bar switches to stations, scroll the section into view
  // after a short delay so StationDashboard has time to render content and
  // the section has its final height.
  useEffect(() => {
    if (selectedView !== 'stations' || !scrollToStationsRef.current) return
    scrollToStationsRef.current = false
    const el = stationsSectionRef.current
    if (!el) return
    // Use start instead of center so the section aligns to the top of the
    // viewport, preventing content drift on subsequent visits.
    const doScroll = () => el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // Give content time to render before scrolling.
    const timer = setTimeout(doScroll, 600)
    return () => clearTimeout(timer)
  }, [selectedView])

  // B-NEW-37 (2026-08-18): 'map' is no longer a valid MobileTab. If a
  // saved URL still lands here we fall back to 'models' so the
  // mobile tab bar never strands the user on a disabled tab.
  const mobileTabFromView = selectedView === 'stations'
    ? 'stations'
    : 'models'

  // B-NEW-30 (2026-07-30): expose the mobile-header height as
  // a CSS custom property on `:root` so the InsightsTable's
  // sticky toolbar + sticky thead can pin themselves to the
  // correct y-offset when the user scrolls on a phone. Without
  // this, the sticky elements have no way to know how tall the
  // header above them is (it varies with the saved-locations
  // strip and with the collapsed/expanded padding state), and
  // they'd either overlap the header or leave a gap.
  //
  // We use a ResizeObserver instead of measuring on every
  // render because the header's height changes mid-session
  // (e.g. when a saved-location chip is added, the strip
  // grows by ~30 px). The observer updates the CSS variable
  // synchronously, so the next paint already has the right
  // offset.
  //
  // On desktop the mobile header is hidden (the
  // `real-desktop:hidden` class sets `display: none` at the
  // real-desktop breakpoint), so the observer measures a
  // 0-height element and `--mobile-header-h` is `0px`. The
  // InsightsTable's sticky positions then collapse to the
  // viewport top, which matches the pre-B-NEW-30 behaviour.
  const mobileHeaderRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const el = mobileHeaderRef.current
    if (!el) return
    const measure = () => {
      const h = el.getBoundingClientRect().height
      // Use 0 for the desktop case (the header is
      // `display: none` so its height is 0). We round to the
      // nearest integer to keep the CSS variable clean.
      const value = Math.max(0, Math.round(h))
      document.documentElement.style.setProperty('--mobile-header-h', `${value}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground overflow-x-hidden pb-[calc(52px+env(safe-area-inset-bottom))] real-desktop:pb-0">
      {/* MOBILE-ONLY: compact top header (search + range pill + refresh). */}
      <div
        ref={mobileHeaderRef}
        data-header-collapsed={isHeaderCollapsed ? 'true' : 'false'}
        className={`real-desktop:hidden sticky top-0 z-[1100] bg-surface-raised border-b border-border shrink-0 transition-[padding] duration-150 ${
          isHeaderCollapsed ? 'py-1' : 'py-1.5'
        }`}
      >
        <div className="flex items-center gap-1.5 px-3">
          <div className="relative flex-1 min-w-0 z-50">
            <CitySearch onSelect={handleCitySelect} />
          </div>
        </div>
        {/* B-NEW-29 (2026-07-30): the saved-locations strip now
            lives directly under the search bar (instead of being
            buried in the main content flow). On mobile the user
            wants one-tap access to their bookmarks without
            scrolling past the metrics, the air-quality card and
            the forecast map. The strip renders nothing when
            `saved` is empty, so the header height stays compact
            on first use. We keep it inside the sticky top header
            so the chips stay reachable while the user scrolls. */}
        <SavedLocations onSelect={handleCitySelect} />
      </div>

      {/* MOBILE-ONLY: secondary header (geo, map toggle, theme, lang, hamburger). */}
      <div ref={mobileMenuRef} className="real-desktop:hidden px-3 py-1.5 bg-surface-raised border-b border-border">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <h1 className="text-xs font-semibold text-text-secondary whitespace-nowrap hidden sm:block">Weather</h1>
          <div className="w-px h-4 bg-border hidden sm:block" />
          <button
            onClick={handleGeolocate}
            disabled={geoLoading}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-50"
            title="Use my location"
            aria-label="Use my location"
          >
            {geoLoading ? (
              <div className="w-3.5 h-3.5 border-2 border-border-strong border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
          <button
            onClick={cycleTheme}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646A9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => { toggleLocale(); updateUrl({ locale: locale === 'en' ? 'es' : 'en' }) }}
            className="min-h-[36px] px-2 rounded text-[11px] font-semibold text-text-secondary hover:text-text-primary transition-colors cursor-pointer tracking-wider"
            title={locale === 'en' ? 'Cambiar a español' : 'Switch to English'}
          >
            {locale === 'en' ? 'ES' : 'EN'}
          </button>
          <button
            onClick={() => setMobileMenuOpen(o => !o)}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-text-secondary hover:text-text-primary cursor-pointer ml-auto"
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="mt-2 pt-2 border-t border-border space-y-3 animate-fadeIn">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => saveMutation.mutate()}
                // B-NEW-29 (2026-07-30): the mobile-menu Save
                // button used to ALWAYS be tappable, which
                // meant double-tapping added the same city
                // twice. We now flip into the "already
                // saved" state when the current city is
                // already in the list (matching the
                // CitiesList big button, so both stay in
                // sync). The check uses the shared
                // `isCurrentCitySaved` flag computed at the
                // orchestrator level.
                disabled={saveMutation.isPending || isCurrentCitySaved}
                data-testid="mobile-menu-save"
                aria-pressed={isCurrentCitySaved}
                className={`min-h-[36px] px-3 rounded text-xs font-medium border transition-colors ${
                  isCurrentCitySaved
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 cursor-default'
                    : 'bg-surface-popover text-text-secondary border-border cursor-pointer'
                } disabled:opacity-60`}
              >
                {isCurrentCitySaved
                  ? (locale === 'en' ? 'Saved' : 'Guardado')
                  : (locale === 'en' ? 'Save' : 'Guardar')}
              </button>
              {viewData && (
                <button
                  onClick={() => {
                    const csv = exportForecastCsv(displayModels, viewData.time, viewData.series, effectiveMaxHours, viewData.utcOffsetSeconds)
                    downloadCsv(`forecast-${cityName}-${new Date().toISOString().slice(0, 10)}.csv`, csv)
                  }}
                  className="min-h-[36px] px-3 rounded text-xs font-medium bg-surface-popover text-text-secondary border border-border cursor-pointer"
                >
                  CSV
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        <DesktopSidebar
          active={selectedView}
          onSelect={handleViewSelect}
          layers={{
            // B-NEW-37 (2026-08-18): `showMap` dropped from the
            // LayerState — the map section is permanently disabled
            // and no UI flips it any more.
            marine,
            showBasic,
          }}
          onLayerToggle={{
            // B-NEW-37 (2026-08-18): `map` removed — `handleMapToggle`
            // is gone and the map section no longer mounts.
            marine: handleMarineToggle,
            basic: handleBasicToggle,
          }}
        />

        <main className="flex-1 min-w-0 min-h-0 flex">
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
            {/* Sticky search + range on tablet/desktop, sitting at the top of
                the main column. The metric pills are NOT rendered here — they
                live next to the Map view (which is what they drive). */}
            <div className="hidden real-desktop:block sticky top-0 z-[1000] bg-background/95 backdrop-blur border-b border-border">
              <div className="flex items-center gap-2 px-4 real-desktop:px-6 py-3">
                <div className="relative flex-1 min-w-0">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                  </svg>
                  <CitySearch onSelect={handleCitySelect} />
                </div>
              </div>
              {/* B-NEW-29 (2026-07-30): saved-locations strip
                  sticks directly under the search input on
                  desktop, same as on mobile. The user
                  complained that the previous layout buried
                  the list below the offline banner + the
                  air-quality card, which made the bookmarks
                  hard to find. Renders nothing when empty
                  (SavedLocations returns null). */}
              <SavedLocations onSelect={handleCitySelect} />
            </div>

            {/* F-5: offline banner — visible only when navigator.onLine is false. */}
            {typeof navigator !== 'undefined' && !navigator.onLine && (
              <div className="mx-4 md:mx-6 mt-3 px-3 py-2 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs">
                {offlineSnapshot
                  ? `${STRINGS[locale].offlineBanner ?? 'Offline'} · ${STRINGS[locale].lastSeen ?? 'last seen'} ${new Date(offlineSnapshot.fetchedAt).toLocaleString()}`
                  : (STRINGS[locale].offlineBanner ?? 'Offline — no cached data')}
              </div>
            )}

            <div
              // eslint-disable-next-line react-hooks/refs
              ref={pullToRefreshRef.ref}
              className="p-3 real-desktop:p-4 real-desktop:space-y-4 space-y-3"
            >
              {/* B-NEW-37 (2026-08-18): removed 'map' from the render-guard
                  union — no `selectedView === 'map'` path is reachable any
                  more, so the conditional collapses to the three live
                  views. */}
              {(selectedView === 'weather' || selectedView === 'cities' || selectedView === 'stations') && (
                <>
                <FriendlyHome
                  city={cityName}
                  cityIsLoading={isLoading && !viewData}
                  models={displayModels}
                  activeIds={displayActiveModelIds}
                  time={effectiveData?.time ?? []}
                  series={effectiveData?.series ?? {}}
                  nowIndex={startIndex + selectedHour}
                  selectedHourOffset={selectedHour}
                  utcOffsetSeconds={effectiveData?.utcOffsetSeconds ?? 0}
                  liveUvIndex={liveUv?.uvIndex ?? null}
                  liveUvValidAt={liveUv?.uvIndexValidAt ?? null}
                  fetchedAt={data?.fetchedAt ?? null}
                  forecastAgeMs={forecastAgeMs}
                  dailyPrecipitationSum={effectiveData?.dailyPrecipitationSum}
                  userLat={position[0]}
                  userLon={position[1]}
                  // BUG FIX: previously the parent never passed
                  // `stations` so FriendlyHome's default `[]` was
                  // used, which meant the nowcast hook always
                  // ran with an empty list. The stations are now
                  // fetched here (useNearbyStations) and threaded
                  // down so the closest-station blend actually
                  // works.
                  stations={nearbyStations}
                  // B-NEW-10 (2026-07-25): thread the ensemble toggle
                  // through to FriendlyHome so the AHORA + future
                  // slots in the hourly strip respect the toggle.
                  // Default 'wedai' keeps the friendly overview on
                  // the calibrated ensemble — the user expects
                  // "Previsión de hoy" to follow whatever the Avanzado
                  // toggle says.
                  ensembleMode={ensembleMode}
                  // Sprint 13: the auto-derived profile (or null
                  // while the classifier is in flight) and the
                  // backtest recommendation set. Empty set means
                  // no boost is applied — the snapshot degrades
                  // to the pre-Sprint-13 behaviour byte-for-byte.
                  usageProfile={effectiveProfile.profile}
                  usageProfileRecommended={recommendedSet}
                  // F5 (revised): the EU AQI value is rendered
                  // inside the Métricas block (via AirConditionsGrid)
                  // so it shows on every viewport including mobile
                  // portrait.
                  europeanAqi={currentEuropeanAqi}
                  // F5 (revised, second pass): pollen values feed
                  // the toggle tile inside the Métricas block.
                  grassPollen={currentGrassPollen}
                  birchPollen={currentBirchPollen}
                />
                </>
              )}

              {/* F5 (revised, second pass): the standalone
                  `AirQualityCard` is gone. Air quality and
                  pollen now live exclusively inside the
                  Métricas block (EU AQI tile + Pollen toggle
                  tile) on every viewport, so the user gets
                  the headline values without scrolling past
                  a 10-tile grid. The data is still fetched
                  (see `airQualityQuery` above) because the
                  Métricas tiles depend on it. */}

              {/* B-NEW-29 (2026-07-30): the saved-locations
                  strip used to live HERE, below the offline
                  banner + the AirConditionsGrid + the map. The
                  user reported it was hard to reach on mobile
                  because a 3-4 screenfuls of metrics sat
                  between the search bar and the chips. We
                  moved it directly under the search bar in
                  both the mobile sticky header (above) and
                  the desktop sticky search row (also above)
                  so the chips are one tap away. The render
                  here is intentionally removed; the component
                  itself is rendered twice above (once for
                  mobile, once for desktop). */}

                {/* B-NEW-37 (2026-08-18): the Mapa view is gone entirely.
                    The previous `{false && …}` wrapper that preserved the
                    dead JSX has been deleted — `showMap`, `handleMapToggle`,
                    `mapSectionRef`, `scrollToMapRef` and the MapPicker import
                    are all gone with it. The URL state still carries
                    `showMap` and `view: 'map'` for backwards compat with
                    saved views, but no UI flips them on. */}

                {selectedView === 'weather' && (
                <AdvancedSection
                  expanded={advancedExpanded}
                  onToggle={() => setAdvancedExpanded(o => !o)}
                  displayModels={displayModels}
                  displayActiveModelIds={displayActiveModelIds}
                  selectedModels={selectedModels}
                  selectedHour={safeSelectedHour}
                  viewData={viewData}
                  fullData={effectiveData}
                  startIndex={startIndex}
                  insightsStartIndex={insightsStartIndex}
                  effectiveMaxHours={effectiveMaxHours}
                  bucket={bucket}
                  marine={marine}
                  onMarineToggle={handleMarineToggle}
                  showBasic={showBasic}
                  onBasicToggle={handleBasicToggle}
                  onModelChange={handleModelChange}
                  onHourChange={handleHourChange}
                  onBucketChange={handleBucketChange}
                  ensembleMode={ensembleMode}
                  onEnsembleModeChange={handleEnsembleModeChange}
                  weekDays={weekDays}
                  // Round-trip every coord change down to 2 decimals so
                  // a fresh /api/forecast that re-issues the same cell
                  // doesn't reset the user's day filter.
                  locationKey={`${position[0].toFixed(2)}:${position[1].toFixed(2)}`}
                />
              )}

              {selectedView === 'cities' && (
                <section className="rounded-2xl border border-border bg-surface-raised p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary mb-1">
                      {locale === 'en' ? 'Cities' : 'Ciudades'}
                    </h3>
                    <p className="text-xs text-text-tertiary">
                      {locale === 'en'
                        ? 'Manage your saved locations. Tap one to jump to it.'
                        : 'Gestiona tus ubicaciones guardadas. Toca una para ir a ella.'}
                    </p>
                  </div>
                  <CitiesList
                    onSelect={handleCitySelect}
                    currentCityName={cityName}
                    // B-NEW-29: the id lookup is computed once at
                    // the orchestrator level (`currentCityId`
                    // useMemo above) and shared by every Save
                    // button in the app. CitiesList receives the
                    // same value, so the "already saved"
                    // treatment stays in sync if the user adds
                    // or removes the current city from the
                    // panel.
                    currentCityId={currentCityId}
                    onSaveCurrent={() => saveMutation.mutate()}
                    saving={saveMutation.isPending}
                  />
                </section>
              )}

              {selectedView === 'stations' && (
                <section ref={stationsSectionRef}>
                <ErrorBoundary
                  fallback={
                    <div className="text-center py-10" role="alert">
                      <p className="text-sm text-red-400">{STRINGS[locale].stationError}</p>
                      <button
                        onClick={() => window.location.reload()}
                        className="mt-2 text-xs text-text-tertiary hover:text-text-secondary underline cursor-pointer"
                      >
                        {STRINGS[locale].retry}
                      </button>
                    </div>
                  }
                >
                   {/* B-NEW-35 (2026-08-18): feed the dashboard the URL
                       coords, not the local `position` state, so the
                       stations API and the nowcast above use the
                       exact same source-of-truth as the URL bar. The
                       local `position` is only used for imperative
                       moves (map drag, geolocation) and lags one
                       render when the URL changes. */}
                   <StationDashboard position={[urlState.lat, urlState.lon]} placeName={cityName} />
                </ErrorBoundary>
                </section>
              )}

              {selectedView === 'settings' && (
                <SettingsPanel
                  marine={marine}
                  onMarineToggle={handleMarineToggle}
                  showBasic={showBasic}
                  onBasicToggle={handleBasicToggle}
                  cityName={cityName}
                  positionLat={position[0]}
                  positionLon={position[1]}
                  viewData={viewData ? { time: viewData.time, series: viewData.series, utcOffsetSeconds: viewData.utcOffsetSeconds } : null}
                  displayModels={displayModels}
                  effectiveMaxHours={effectiveMaxHours}
                  selectedMetric={selectedMetric}
                />
              )}
            </div>
          </div>

          <aside
            aria-label={STRINGS[locale].weekTitle}
            className="hidden real-desktop:block w-[320px] shrink-0 border-l border-border overflow-y-auto"
            style={{ maxHeight: 'calc(100dvh)' }}
          >
            <div className="p-4 real-desktop:p-5 space-y-4 real-desktop:sticky real-desktop:top-0">
              <WeekForecastPanel
                models={displayModels}
                activeIds={displayActiveModelIds}
                time={effectiveData?.time ?? []}
                series={effectiveData?.series ?? {}}
                nowIndex={startIndex + safeSelectedHour}
                maxHours={Math.max(startIndex + safeSelectedHour, 0) + weekDays * 24}
                weekDays={weekDays}
                onWeekDaysChange={(d) => {
                  // WeekForecastPanel needs `range` to cover `weekDays * 24`
                  // hours of forecast data; bumping one without the other
                  // silently caps the panel to fewer days than requested.
                  const requiredHours = d * 24
                  updateUrl({
                    weekDays: d,
                    range: Math.max(requiredHours, urlState.range),
                  })
                }}
                onSelectHour={handleHourChange}
                // B-NEW-10 (2026-07-25): thread the ensemble toggle
                // through to Próximos días so the daily highs/lows
                // use the calibrated ensemble when the Avanzado
                // toggle is on WedAI.
                ensembleMode={ensembleMode}
              />
            </div>
          </aside>
        </main>
      </div>

      {/* F-9: footer keyboard hints, hidden on mobile (mobile tab bar lives at the bottom). */}
      <div className="hidden real-desktop:flex real-desktop:mt-auto px-3 py-0.5 bg-surface/50 border-t border-border text-[9px] text-text-tertiary gap-3 shrink-0">
        <span>← → {STRINGS[locale].footerHours}</span>
        <span>/ {STRINGS[locale].footerSearch}</span>
        <span>m {STRINGS[locale].footerMap}</span>
        <a href="/premium" className="ml-auto hover:text-text-primary">Premium</a>
        <a href="/admin" className="hover:text-text-primary">Admin</a>
      </div>

      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[2000] bg-surface-popover border border-border text-text-primary text-xs px-3 py-1.5 rounded-md shadow-lg animate-fadeIn"
          style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
        >
          {toast}
        </div>
      )}

      <MobileTabBar
        active={mobileTabFromView}
        onChange={(next) => {
          // B-NEW-37 (2026-08-18): the Mapa tab is removed from
          // MobileTabBar, so 'map' can never be passed in. Stations
          // still scrolls into view on tap; everything else defaults
          // back to the Tiempo view.
          if (next === 'stations') {
            scrollToStationsRef.current = true
            handleViewSelect('stations')
          } else {
            handleViewSelect('weather')
          }
        }}
      />
    </div>
  )
}

/**
 * Avanzado (model selector + Insights table) is wrapped in a
 * memoised component so the heavy subtree only re-renders when one of
 * its actual props changes. Without this memo, every URL state change
 * (e.g. toggling a model) re-runs the DailySummary and InsightsTable
 * tree, which is the dominant cost on slow mobile. The model
 * comparison chart was removed (2026-07-28) — see comment above.
 */
const AdvancedSection = memo(function AdvancedSection({
  expanded,
  onToggle,
  displayModels,
  displayActiveModelIds,
  selectedModels,
  selectedHour,
  viewData,
  fullData,
  startIndex,
  insightsStartIndex,
  effectiveMaxHours,
  bucket,
  marine,
  onMarineToggle,
  showBasic,
  onBasicToggle,
  onModelChange,
  onHourChange,
  onBucketChange,
  ensembleMode,
  onEnsembleModeChange,
  weekDays,
  locationKey,
}: {
  expanded: boolean
  onToggle: () => void
  displayModels: WeatherModel[]
  displayActiveModelIds: string[]
  selectedModels: string[]
  selectedHour: number
  viewData: ReturnType<typeof sliceForecast> | NonNullable<Awaited<ReturnType<typeof fetchForecast>>> | null
  fullData: NonNullable<Awaited<ReturnType<typeof fetchForecast>>> | null
  startIndex: number
  /** Insights-only anchor, computed against the wall clock. DailySummary
   *  and the slider keep using `startIndex` so the shared "now" contract
   *  (anchored to `fetchedAt`) is preserved everywhere else. */
  insightsStartIndex: number
  effectiveMaxHours: number
  bucket: BucketHours
  marine: boolean
  onMarineToggle: () => void
  showBasic: boolean
  onBasicToggle: () => void
  onModelChange: (ids: string[]) => void
  onHourChange: (hour: number) => void
  onBucketChange: (b: BucketHours) => void
  ensembleMode: 'wedai' | 'models'
  onEnsembleModeChange: (mode: 'wedai' | 'models') => void
  weekDays: 7 | 14
  /** Stable per-location string used to reset the day filter when the
   *  user navigates to a different city. Coordinates are rounded to 2
   *  decimals (the same precision the cache key uses) so the same cell
   *  re-issued by a fresh forecast doesn't destroy the filter. */
  locationKey: string
}) {
  const { locale } = useLocale()
  const s = STRINGS[locale]
  // Pre-extract the dense props so the JSX below is readable. Wrap
  // them in `useMemo` so the `[]` fallbacks don't return a fresh
  // array on every render — that would re-trigger the
  // `insightsViewTimes` / `insightsViewSeries` memos below on every
  // keystroke from a sibling state change.
  const viewTimes = useMemo(() => viewData?.time ?? [], [viewData])
  const viewSeries = useMemo(() => viewData?.series ?? {}, [viewData])
  const viewUtc = viewData?.utcOffsetSeconds ?? 0
  // Use full (untrimmed) data for DailySummary so it can show all 14 days
  // from the start of the forecast, not just from the current hour.
  const fullTimes = fullData?.time ?? []
  const fullSeries = fullData?.series ?? {}
  const fullUtc = fullData?.utcOffsetSeconds ?? 0

  // Day filter: when the user taps a daily summary card we slice the
  // Insights table from that day's 00:00 onwards. The filter is local
  // to this component (it never touches the URL hour, the slider, the
  // map, or the DailySummary's `selectedHour`) so a "Ver desde hoy"
  // press is a pure view change. The filter clears automatically when
  // the user navigates to a different location.
  const [dayFilter, setDayFilter] = useState<InsightsDayFilter | null>(null)
  const prevLocationKeyRef = useRef(locationKey)
  useEffect(() => {
    if (prevLocationKeyRef.current !== locationKey) {
      prevLocationKeyRef.current = locationKey
      setDayFilter(null)
    }
  }, [locationKey])

  // When the filter is active the Insights table is sliced from the
  // filter's 00:00 (taken from the *full* data, not `viewTimes`).
  // That way the user can ask for "from today 00:00" even when the
  // current wall clock is past midnight — the table re-anchors on
  // the day at index `dayFilter.startIndex` in `fullTimes`.
  //
  // The wall-clock offset (no-filter branch) is the same
  // `insightsViewStartIndex` the rest of the module has used since
  // the wall-clock anchor was introduced; we keep the variable
  // around so the no-filter branch stays a pure pass-through to the
  // legacy behaviour.
  const insightsViewStartIndex = Math.max(0, insightsStartIndex - startIndex)
  const activeSliceBase = dayFilter ? fullTimes : viewTimes
  const activeSliceSeries = dayFilter ? fullSeries : viewSeries
  const activeSliceStartIndex = dayFilter
    ? dayFilter.startIndex
    : insightsViewStartIndex
  const insightsViewTimes = useMemo(
    () => activeSliceBase.slice(activeSliceStartIndex),
    [activeSliceBase, activeSliceStartIndex],
  )
  const insightsViewSeries = useMemo(() => {
    const out: Record<string, Record<string, (number | null)[]>> = {}
    for (const modelId of Object.keys(activeSliceSeries)) {
      const metrics = activeSliceSeries[modelId]
      const sliced: Record<string, (number | null)[]> = {}
      for (const metricId of Object.keys(metrics)) {
        const arr = metrics[metricId]
        sliced[metricId] = arr === null ? arr : arr.slice(activeSliceStartIndex)
      }
      out[modelId] = sliced
    }
    return out
  }, [activeSliceSeries, activeSliceStartIndex])
  // When the filter is active the active row is the noonIndex inside
  // the filtered window. Otherwise we keep the wall-clock → URL-state
  // conversion the old logic used.
  const insightsSelectedHour = dayFilter
    ? Math.max(0, dayFilter.anchor - dayFilter.startIndex)
    : Math.max(0, selectedHour - insightsViewStartIndex)
  // `viewStartIndex` is the offset the table adds to `r.centerIdx`
  // before calling `onSelectHour`, so the URL hour stays in the
  // expected coord system. With the filter, the offset is back in
  // the FULL data array (the table was sliced from `fullTimes`),
  // so we subtract `startIndex` to convert back to `viewTimes`.
  const effectiveViewStartIndex = dayFilter
    ? dayFilter.startIndex - startIndex
    : insightsViewStartIndex
  const insightsMaxHours = insightsViewTimes.length || effectiveMaxHours
  const handleDayFilter = useCallback((day: { startIndex: number; noonIndex: number; label: string }) => {
    setDayFilter({ startIndex: day.startIndex, anchor: day.noonIndex, label: day.label })
  }, [])
  const handleClearDayFilter = useCallback(() => setDayFilter(null), [])
  // Row clicks exit the filter view: the user is intentionally
  // picking a specific hour, which is a different intent than
  // "show me the data from this day onwards". Pass the row's
  // hour through to `onHourChange` (which clamps to >= 0) and
  // drop the filter so the table re-renders at full horizon.
  const handleInsightsRowSelect = useCallback((hour: number) => {
    setDayFilter(null)
    onHourChange(hour)
  }, [onHourChange])

  return (
    <section className="rounded-2xl border border-border bg-surface-raised overflow-hidden">
      {/* Mobile (< md): tap the header to toggle the Avanzado section. */}
      <button
        type="button"
        onClick={onToggle}
        className="real-desktop:hidden w-full px-4 py-3 flex items-center justify-between text-text-primary hover:bg-surface-popover/40 transition-colors cursor-pointer"
        aria-expanded={expanded}
        aria-controls="advanced-section"
      >
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-semibold text-text-tertiary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
            <path d="M3 17l6-6 4 4 8-8" />
            <path d="M14 7h7v7" />
          </svg>
          {s.navAdvanced}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={`w-4 h-4 text-text-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {/* Desktop (>= md): collapsible header. */}
      <button
        type="button"
        onClick={onToggle}
        className="hidden real-desktop:flex w-full items-center justify-between px-4 py-3 text-text-primary hover:bg-surface-popover/40 transition-colors"
        aria-expanded={expanded}
        aria-controls="advanced-section"
      >
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-semibold text-text-tertiary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
            <path d="M3 17l6-6 4 4 8-8" />
            <path d="M14 7h7v7" />
          </svg>
          {s.navAdvanced}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={`w-4 h-4 text-text-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {expanded ? (
        <div id="advanced-section" className="px-4 pb-4 space-y-3">
          <DailySummary
            models={displayModels}
            activeModelIds={displayActiveModelIds}
            times={fullTimes}
            series={fullSeries}
            selectedHour={startIndex + selectedHour}
            onSelectHour={(hour) => onHourChange(hour - startIndex)}
            onSelectDay={handleDayFilter}
            // When the filter is active the active highlight follows
            // the filter, not the URL hour. The user wants the
            // filter to be the *only* change a card click triggers.
            activeDayStartIndex={dayFilter?.startIndex ?? null}
            // Show exactly `weekDays` calendar days: remainder of the
            // current day + (weekDays - 1) full days. When startIndex falls
            // on midnight we count the full current day (24 h). Any indices
            // past the array are naturally dropped by DailySummary.
            maxHours={(() => {
              const rem = startIndex % 24
              const toMidnight = rem === 0 ? 24 : 24 - rem
              return Math.min(fullTimes.length, startIndex + toMidnight + (weekDays - 1) * 24)
            })()}
            showMarine={marine}
            showBasic={showBasic}
            utcOffsetSeconds={fullUtc}
            startIndex={startIndex}
            // B-NEW-10 (2026-07-25): thread the ensemble toggle so
            // Resumen diario uses the calibrated full ensemble when
            // the Avanzado toggle is on WedAI.
            ensembleMode={ensembleMode}
          />
          <ModelSelector
            models={displayModels}
            selected={selectedModels}
            onChange={onModelChange}
            ensembleMode={ensembleMode}
            onEnsembleModeChange={onEnsembleModeChange}
          />
          <InsightsTable
            models={displayModels}
            activeModelIds={displayActiveModelIds}
            // The Insights table is anchored to the *wall-clock current
            // hour* (the user asked the data to always start at "now"),
            // not the hour the cached forecast was issued. When the day
            // filter is active, the table is sliced from the FULL data
            // array at `dayFilter.startIndex` instead. `viewStartIndex`
            // is adjusted so the `onSelectHour` callback still produces
            // a URL hour in the same coord system the slider uses.
            times={insightsViewTimes}
            series={insightsViewSeries}
            fullTimes={insightsViewTimes}
            fullSeries={insightsViewSeries}
            startIndex={dayFilter ? dayFilter.startIndex : insightsStartIndex}
            viewStartIndex={effectiveViewStartIndex}
            weekDays={weekDays}
            bucket={bucket}
            onBucketChange={onBucketChange}
            selectedHour={insightsSelectedHour}
            onSelectHour={handleInsightsRowSelect}
            maxHours={insightsMaxHours}
            utcOffsetSeconds={viewUtc}
            showMarine={marine}
            onMarineToggle={onMarineToggle}
            showBasic={showBasic}
            onBasicToggle={onBasicToggle}
            ensembleMode={ensembleMode}
            dayFilter={dayFilter}
            onClearDayFilter={handleClearDayFilter}
          />
        </div>
      ) : null}
    </section>
  )
})

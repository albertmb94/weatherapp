import { useEffect, useRef, useCallback, useState } from 'react'
import { METRICS } from './models'

interface UrlState {
  lat: number
  lon: number
  metric: string
  models: string[]
  hour: number
  range: number
  bucket: number
  locale: string
  marine: boolean
  basic: boolean
  // B-NEW-37 (2026-08-18): 'map' removed from the view union. Saved URLs
  // still carrying `?view=map` fall back to 'weather' (see the parser
  // below) so the type accurately reflects what the renderer can
  // ever observe.
  view: 'weather' | 'cities' | 'stations' | 'settings'
  weekDays: 7 | 14
  ensembleMode: 'wedai' | 'models'
}

const ALLOWED_BUCKETS = new Set([1, 2, 3, 4, 6, 12, 24])
const ALLOWED_METRICS = new Set<string>(METRICS.map(m => m.id))
const ALLOWED_RANGES = new Set([24, 48, 72, 168, 336])
// B-NEW-37 (2026-08-18): 'map' removed — saved ?view=map URLs are
// ignored by the parser, defaulting the view back to 'weather'.
const ALLOWED_VIEWS = new Set(['weather', 'cities', 'stations', 'settings'])
const ALLOWED_WEEK_DAYS = new Set([7, 14])
const ALLOWED_ENSEMBLE_MODES = new Set(['wedai', 'models'])

const MODELS_NONE_TOKEN = 'none'

function parseUrlParams(params: URLSearchParams): Partial<UrlState> {
  const result: Partial<UrlState> = {}
  const lat = params.get('lat')
  const lon = params.get('lon')
  if (
    lat !== null && lon !== null &&
    !isNaN(Number(lat)) && !isNaN(Number(lon)) &&
    Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180
  ) {
    result.lat = Number(lat)
    result.lon = Number(lon)
  }
  const metric = params.get('metric')
  if (metric && ALLOWED_METRICS.has(metric)) result.metric = metric
  const models = params.get('models')
  if (models !== null) {
    result.models = models === MODELS_NONE_TOKEN ? [] : models.split(',').filter(Boolean)
  }
  const hour = params.get('hour')
  if (hour && !isNaN(Number(hour)) && Number(hour) >= 0) result.hour = Number(hour)
  const range = params.get('range')
  if (range && ALLOWED_RANGES.has(Number(range))) result.range = Number(range)
  const bucket = params.get('bucket')
  if (bucket && ALLOWED_BUCKETS.has(Number(bucket))) result.bucket = Number(bucket)
  const locale = params.get('locale')
  if (locale === 'en' || locale === 'es') result.locale = locale
  const marine = params.get('marine')
  if (marine !== null) result.marine = marine === '1'
  const basic = params.get('basic')
  if (basic !== null) result.basic = basic === '1'
  const view = params.get('view')
  if (view && ALLOWED_VIEWS.has(view)) {
    result.view = view as UrlState['view']
  }
  const weekDays = params.get('week')
  if (weekDays && ALLOWED_WEEK_DAYS.has(Number(weekDays))) {
    result.weekDays = Number(weekDays) as UrlState['weekDays']
  }
  const ensembleMode = params.get('emode')
  if (ensembleMode && ALLOWED_ENSEMBLE_MODES.has(ensembleMode)) {
    result.ensembleMode = ensembleMode as UrlState['ensembleMode']
  }
  return result
}

function modelsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function buildQuery(state: UrlState, defaults: UrlState): string {
  const params = new URLSearchParams()
  if (state.lat !== defaults.lat || state.lon !== defaults.lon) {
    params.set('lat', state.lat.toFixed(4))
    params.set('lon', state.lon.toFixed(4))
  }
  if (state.metric !== defaults.metric) params.set('metric', state.metric)
  if (!modelsEqual(state.models, defaults.models) && state.models.length > 0) {
    params.set('models', state.models.join(','))
  }
  // hour is intentionally NOT persisted to the URL so every fresh page load
  // starts at hour 0 (today) in the daily summary.
  if (state.range !== defaults.range) params.set('range', String(state.range))
  if (state.bucket !== defaults.bucket) params.set('bucket', String(state.bucket))
  // El idioma YA NO se escribe en el query string: vive en la ruta
  // (/premium vs /en/premium). Seguir escribiendolo dejaria dos fuentes
  // de verdad compitiendo, y la del query string es la que no se puede
  // indexar ni sirve para <html lang>. Se sigue LEYENDO en parseUrlParams
  // para que los enlaces ya compartidos con ?locale=en sigan llevando a
  // la version inglesa (app/home-content.tsx los traduce navegando).
  if (state.marine !== defaults.marine) params.set('marine', state.marine ? '1' : '0')
  if (state.basic !== defaults.basic) params.set('basic', state.basic ? '1' : '0')
  if (state.view !== defaults.view) params.set('view', state.view)
  if (state.weekDays !== defaults.weekDays) params.set('week', String(state.weekDays))
  if (state.ensembleMode !== defaults.ensembleMode) params.set('emode', state.ensembleMode)
  return params.toString()
}

export function useUrlState(defaults: UrlState): [UrlState, (updates: Partial<UrlState>) => void] {
  const lastPushedQuery = useRef<string | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // SSR-safe initial state: always start with `defaults` so the server
  // render and the first client render are byte-identical. Reading
  // `window.location.search` here would diverge from the server (which
  // has no `window`) and trigger React's hydration error #418 on every
  // deep link. The URL state is resynced in a useEffect below.
  const [state, setState] = useState<UrlState>(() => ({ ...defaults }))

  // After mount, fold the real URL params into the state. Any defaults
  // not overridden by the URL stay at their current value.
  const initialUrlAppliedRef = useRef(false)
  useEffect(() => {
    if (initialUrlAppliedRef.current) return
    initialUrlAppliedRef.current = true
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const parsed = parseUrlParams(params)
    // Empty URL → keep defaults. The popstate handler in this hook
    // already covers the case where the user navigates back to "/" via
    // the browser, so we only need to layer the URL on top of whatever
    // the current state is.
    if (Object.keys(parsed).length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(prev => ({ ...prev, ...parsed }))
  }, [])

  // Sync URL whenever state changes. Use window.history.replaceState to avoid
  // a Next.js re-render cycle (router.replace would re-trigger this hook).
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      const query = buildQuery(state, defaults)
      if (query === lastPushedQuery.current) return
      lastPushedQuery.current = query
      const href = query ? `${window.location.pathname}?${query}` : window.location.pathname
      window.history.replaceState(null, '', href)
    }, 300)
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [state, defaults])

  // React to back/forward navigation only.
  useEffect(() => {
    function onPopState() {
      const params = new URLSearchParams(window.location.search)
      const parsed = parseUrlParams(params)
      setState(prev => {
        // B-NEW-1: an empty `parsed` (browser back to the clean URL)
        // must restore the SSR-safe defaults rather than leaving the
        // previous city/metric/range active. The early-return we had
        // here was the root cause of "atrás no me lleva al inicio".
        if (Object.keys(parsed).length === 0) return defaults
        const hasChange = Object.entries(parsed).some(([key, value]) => {
          const prevValue = prev[key as keyof UrlState]
          if (Array.isArray(prevValue) && Array.isArray(value)) {
            return prevValue.length !== value.length || prevValue.some((v, i) => v !== value[i])
          }
          return prevValue !== value
        })
        if (!hasChange) return prev
        return { ...prev, ...parsed }
      })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [defaults])

  const update = useCallback((updates: Partial<UrlState>) => {
    setState(prev => ({ ...prev, ...updates }))
  }, [])

  return [state, update]
}

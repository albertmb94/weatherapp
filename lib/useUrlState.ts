import { useEffect, useRef, useCallback, useState } from 'react'
import { METRICS } from './models'

interface UrlState {
  lat: number
  lon: number
  metric: string
  models: string[]
  hour: number
  range: number
  showMap: boolean
  showRadar: boolean
  bucket: number
  locale: string
  marine: boolean
  basic: boolean
}

const ALLOWED_BUCKETS = new Set([1, 2, 3, 4, 6, 12, 24])
const ALLOWED_METRICS = new Set<string>(METRICS.map(m => m.id))
const ALLOWED_RANGES = new Set([24, 48, 72, 168, 336])

const MODELS_NONE_TOKEN = 'none'

function parseUrlParams(params: URLSearchParams): Partial<UrlState> {
  const result: Partial<UrlState> = {}
  const lat = params.get('lat')
  const lon = params.get('lon')
  if (lat && lon && !isNaN(Number(lat)) && !isNaN(Number(lon))) {
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
  if (hour && !isNaN(Number(hour))) result.hour = Number(hour)
  const range = params.get('range')
  if (range && ALLOWED_RANGES.has(Number(range))) result.range = Number(range)
  const showMap = params.get('map')
  if (showMap !== null) result.showMap = showMap === '1'
  const showRadar = params.get('radar')
  if (showRadar !== null) result.showRadar = showRadar === '1'
  const bucket = params.get('bucket')
  if (bucket && ALLOWED_BUCKETS.has(Number(bucket))) result.bucket = Number(bucket)
  const locale = params.get('locale')
  if (locale === 'en' || locale === 'es') result.locale = locale
  const marine = params.get('marine')
  if (marine !== null) result.marine = marine === '1'
  const basic = params.get('basic')
  if (basic !== null) result.basic = basic === '1'
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
  if (!modelsEqual(state.models, defaults.models)) {
    params.set('models', state.models.length === 0 ? MODELS_NONE_TOKEN : state.models.join(','))
  }
  if (state.hour !== defaults.hour) params.set('hour', String(state.hour))
  if (state.range !== defaults.range) params.set('range', String(state.range))
  if (state.showMap !== defaults.showMap) params.set('map', state.showMap ? '1' : '0')
  if (state.showRadar !== defaults.showRadar) params.set('radar', state.showRadar ? '1' : '0')
  if (state.bucket !== defaults.bucket) params.set('bucket', String(state.bucket))
  if (state.locale !== defaults.locale) params.set('locale', state.locale)
  if (state.marine !== defaults.marine) params.set('marine', state.marine ? '1' : '0')
  if (state.basic !== defaults.basic) params.set('basic', state.basic ? '1' : '0')
  return params.toString()
}

export function useUrlState(defaults: UrlState): [UrlState, (updates: Partial<UrlState>) => void] {
  const lastPushedQuery = useRef<string | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRef = useRef<UrlState | null>(null)

  const [state, setState] = useState<UrlState>(() => {
    const params = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams()
    const parsed = parseUrlParams(params)
    const initial: UrlState = {
      lat: parsed.lat ?? defaults.lat,
      lon: parsed.lon ?? defaults.lon,
      metric: parsed.metric ?? defaults.metric,
      models: parsed.models ?? defaults.models,
      hour: parsed.hour ?? defaults.hour,
      range: parsed.range ?? defaults.range,
      showMap: parsed.showMap ?? defaults.showMap,
      showRadar: parsed.showRadar ?? defaults.showRadar,
      bucket: parsed.bucket ?? defaults.bucket,
      locale: parsed.locale ?? defaults.locale,
      marine: parsed.marine ?? defaults.marine,
      basic: parsed.basic ?? defaults.basic,
    }
    return initial
  })

  // Sync URL whenever state changes. Use window.history.replaceState to avoid
  // a Next.js re-render cycle (router.replace would re-trigger this hook).
  useEffect(() => {
    stateRef.current = state
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
